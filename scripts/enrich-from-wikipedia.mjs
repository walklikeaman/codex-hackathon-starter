#!/usr/bin/env node
//
// Read filming locations out of Wikipedia prose and queue them for review (#47).
//
//   node scripts/enrich-from-wikipedia.mjs [--limit 5] [--dry-run] [--work <uuid>]
//
// Deliberately a script and not a route. It is slow by design — one request a second
// to Wikimedia, five seconds between Wikidata queries — because the pacing is the
// difference between being a good citizen of two free services and being blocked by
// them. Nothing about this needs to happen while somebody waits.
//
// Nothing it produces reaches the map. Every location lands in `location_submissions`
// as `pending`, which is the queue #48's review gate was built for.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  apiError,
  articleTitleFromEntity,
  buildEntitiesUrl,
  buildSectionUrl,
  buildTocUrl,
  chooseSection,
  cleanWikitext,
  MIN_REQUEST_GAP_MS,
  USER_AGENT,
  wikipediaAttribution,
} from "../app/lib/wikipedia-source.mjs";
import {
  acceptExtraction,
  buildExtractionInput,
  extractionInstructions,
  wikipediaLocationsSchema,
} from "../app/lib/wikipedia-extract.mjs";
import {
  buildGeocodeQuery,
  chooseCandidate,
  groupByName,
  MAX_NAMES_PER_QUERY,
  QUERY_GAP_MS,
  retryPlan,
  WIKIDATA_LICENSE,
  WIKIDATA_SPARQL,
} from "../app/lib/geocode-wikidata.mjs";
import { normalizePlaceName } from "../app/lib/place-dedup.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number.parseInt(arg("limit", "5"), 10) || 5;
const ONE_WORK = arg("work", null);

const headers = { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" };

async function wikimedia(url) {
  const response = await fetch(url, { headers });
  // 429/503 carry Retry-After and it is the source of truth, not a guess of ours.
  if (response.status === 429 || response.status === 503) {
    const wait = (Number(response.headers.get("retry-after")) || 60) * 1000;
    console.log(`   waiting ${wait / 1000}s (${response.status})`);
    await sleep(wait);
    return wikimedia(url);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  // Wikimedia answers a missing page with 200 and an error body.
  const error = apiError(payload);
  if (error) throw new Error(error);
  await sleep(MIN_REQUEST_GAP_MS);
  return payload;
}

// Geocode a batch of names through Wikidata. Anything it refuses stays without a
// coordinate rather than being guessed at — the submission is still a real claim.
async function geocode(names) {
  const resolved = new Map();
  const batches = [];
  for (let i = 0; i < names.length; i += MAX_NAMES_PER_QUERY) {
    batches.push(names.slice(i, i + MAX_NAMES_PER_QUERY));
  }

  for (const batch of batches) {
    const query = buildGeocodeQuery(batch);
    if (!query) continue;

    const response = await fetch(WIKIDATA_SPARQL, {
      method: "POST",
      headers: { ...headers, Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query }),
    });

    if (!response.ok) {
      // A timeout and a rate limit mean opposite things; the plan says which.
      const plan = retryPlan(response.status);
      console.log(`   geocoder ${response.status} → ${plan.action}`);
      await sleep(plan.waitMs);
      continue;
    }

    const grouped = groupByName((await response.json()).results?.bindings);
    for (const name of batch) {
      const chosen = chooseCandidate(grouped.get(normalizePlaceName(name)) ?? []);
      resolved.set(name, chosen);
    }
    await sleep(QUERY_GAP_MS);
  }
  return resolved;
}

async function main() {
  const env = process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  // Naming BOTH when only one is missing sends someone to check the variable that was
  // already fine. Say which, and where it goes.
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(", ")}`);
    console.error("Add it to .env.local and run with:");
    console.error("  node --env-file=.env.local scripts/enrich-from-wikipedia.mjs");
    console.error("Edit the file in an editor rather than echoing the value —");
    console.error("a secret typed into a shell stays in your history.");
    process.exit(1);
  }
  if (!env.OPENAI_API_KEY && !DRY_RUN) {
    console.error("OPENAI_API_KEY is required (or pass --dry-run to fetch prose only).");
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

  let query = db.from("works").select("id, title, kind, year, wikidata_id").not("wikidata_id", "is", null);
  if (ONE_WORK) query = query.eq("id", ONE_WORK);
  const { data: works, error } = await query.limit(LIMIT);
  if (error) throw new Error(error.message);
  if (!works?.length) { console.log("Nothing to enrich."); return; }

  // One batched call resolves every article title; the API allows 50 per request.
  const entities = await wikimedia(buildEntitiesUrl(works.map((work) => work.wikidata_id)));

  for (const work of works) {
    const title = articleTitleFromEntity(entities.entities?.[work.wikidata_id]);
    console.log(`\n${work.title}`);
    if (!title) { console.log("   no English article — skipped"); continue; }

    let toc;
    try {
      toc = await wikimedia(buildTocUrl(title));
    } catch (failure) {
      console.log(`   ${failure.message}`);
      continue;
    }

    const section = chooseSection(toc.parse?.tocdata);
    if (!section) { console.log("   no production section — skipped"); continue; }

    const revid = toc.parse?.revid;
    const raw = await wikimedia(buildSectionUrl(title, section.index));
    const prose = cleanWikitext(raw.parse?.wikitext ?? "");
    console.log(`   "${section.line}" → ${prose.length} chars (rev ${revid})`);

    if (DRY_RUN || !openai) { console.log("   dry run — not extracting"); continue; }

    const response = await openai.responses.parse({
      model: env.OPENAI_MODEL || "gpt-5.6-terra",
      store: false,
      max_output_tokens: 4000,
      reasoning: { effort: "low" },
      instructions: extractionInstructions(),
      input: [{ role: "user", content: buildExtractionInput({ ...work, prose }) }],
      text: { format: zodTextFormat(wikipediaLocationsSchema, "wikipedia_locations") },
    }, { timeout: 90_000 });

    if (response.status !== "completed" || !response.output_parsed) {
      console.log(`   extraction ${response.status} — nothing written`);
      continue;
    }

    const { accepted, rejected } = acceptExtraction(response.output_parsed, {
      prose, article: { title, revid },
    });
    console.log(`   ${accepted.length} accepted, ${rejected.length} dropped`
      + (rejected.length ? ` (${[...new Set(rejected.map((r) => r.reason))].join(", ")})` : ""));

    if (accepted.length === 0) continue;

    const located = await geocode(accepted.map((location) => location.place_name));
    const credit = wikipediaAttribution({ title, revid });

    const rows = accepted.map((location) => {
      const chosen = located.get(location.place_name);
      return {
        work_id: work.id,
        place_name: location.place_name,
        area_hint: location.area_hint,
        source_sentence: location.source_sentence,
        source_title: title,
        source_revid: revid,
        source_url: credit.permalink,
        // A coordinate arrives with its provenance or not at all — the table enforces
        // it, and a submission without one is still a real claim worth reviewing.
        ...(chosen?.place
          ? {
            lat: chosen.place.lat,
            lng: chosen.place.lng,
            geocode_source: "wikidata",
            geocode_source_id: chosen.place.wikidata_id,
            geocode_license: WIKIDATA_LICENSE.name,
            geocode_reason: chosen.reason,
          }
          : { geocode_reason: chosen?.reason ?? "not_attempted" }),
      };
    });

    const { error: writeError } = await db
      .from("location_submissions")
      .upsert(rows, { onConflict: "work_id,place_name" });

    if (writeError) console.log(`   write failed: ${writeError.message}`);
    else {
      const placed = rows.filter((row) => row.lat !== undefined).length;
      console.log(`   queued ${rows.length} as pending (${placed} with coordinates)`);
    }
  }
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
