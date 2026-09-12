#!/usr/bin/env node
//
// Filming locations from fan wikis, matched to works by title.
//
//   node --env-file=.env.local scripts/ingest-fandom.mjs --dry-run
//   node --env-file=.env.local scripts/ingest-fandom.mjs --wiki jamesbond --dry-run
//   node --env-file=.env.local scripts/ingest-fandom.mjs
//
// See [[source-evaluation]] for why this source was refused in July and why that refusal
// was wrong: we already ingest three fan projects on exactly these terms, and Fandom was
// held to a standard the rest of the corpus is not.
//
// **Expect hundreds of rows, not thousands.** Measured 10.09.2026, the structured
// locations table exists on the Bond and LOTR wikis and essentially nowhere else. What
// makes it worth the trouble is the PAIRING — the place in the story beside the place the
// camera stood — which almost nothing else we hold carries.
//
// Three refusals are built in and none of them is negotiable:
//   * a non-commercial wiki is skipped entirely, licence read live per wiki;
//   * no image is read, ever — the site licence covers text and the images are studio
//     material under an anonymous fair-use claim;
//   * a table whose shooting-location column cannot be identified yields nothing rather
//     than a guess.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeWorkTitle } from "../app/lib/content-graph.mjs";
import { createModelClient, createThrottle, parseStructured } from "../app/lib/model-client.mjs";
import { cleanWikitext } from "../app/lib/wikipedia-source.mjs";
import {
  acceptExtraction,
  buildExtractionInput,
  extractionInstructions,
  wikipediaLocationsSchema,
} from "../app/lib/wikipedia-extract.mjs";
import {
  licenceAllows,
  headingPromisesStoryPlaces,
  locationSection,
  toProseSubmission,
  matchWork,
  parseLocationRows,
  toSubmission,
} from "../app/lib/fandom-source.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const DRY_RUN = process.argv.includes("--dry-run");
const WRITE_BATCH = 200;

// Prose is opt-in and metered, because it is the only part of this that costs anything.
//
// Measured 11.09 over 48 pages on six wikis: 12 of the 26 pages carrying a filming section
// keep it as prose, which no regular expression reaches. A model can read them — under the
// rule [[location-discovery]] states and this pipeline already follows elsewhere: **a model
// may NAME a place, never locate one.** It names; the geocoding cascade locates afterwards,
// separately, with its own provenance.
//
// The cap is the point. `--prose 40` means at most forty model calls in a run, so the bill
// is known before the run rather than after it, and a wiki that turns out to be all prose
// cannot quietly become the expensive one.
const PROSE_LIMIT = Number(arg("prose", 0));
const PAGE_LIMIT = Number(arg("pages", 60));

// Where the tables actually are. Adding a wiki is one line, and the licence is still
// checked live — a wiki can change its terms, and this list is not permission.
const WIKIS = String(arg("wiki", "jamesbond,lotr")).split(",").map((w) => w.trim()).filter(Boolean);

const UA = { "User-Agent": "GloryMap/1.0 (filming locations; nakonechnyi.n@gmail.com)" };

async function api(wiki, params) {
  const url = `https://${wiki}.fandom.com/api.php?` + new URLSearchParams({ ...params, format: "json" });
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${wiki}: http ${response.status}`);
  return response.json();
}

async function wikiLicence(wiki) {
  const info = await api(wiki, { action: "query", meta: "siteinfo", siprop: "rightsinfo" });
  return info?.query?.rightsinfo ?? {};
}

async function main() {
  // A dry run only reads `works`, which the anon key can do. Demanding the service key for
  // it meant the safe rehearsal needed the dangerous credential — exactly backwards, and it
  // stopped the run that was supposed to precede the run that writes.
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon } = process.env;
  const readKey = key || (DRY_RUN ? anon : null);
  if (!url || !readKey) {
    console.error(DRY_RUN
      ? "Missing NEXT_PUBLIC_SUPABASE_URL, and neither a service nor an anon key"
      : "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (writing needs the service key)");
    process.exit(1);
  }
  const db = createClient(url, readKey, { auth: { persistSession: false } });

  // The catalogue, by normalised title. A wiki page carries no year, so an ambiguous
  // title matches nothing rather than guessing — see `matchWork`.
  const byTitle = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("works").select("id, title, year, kind").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const work of data) {
      const k = normalizeWorkTitle(work.title);
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push(work);
    }
    if (data.length < 1000) break;
  }
  console.log(`catalogue: ${byTitle.size} distinct titles`);

  // **Written as the run goes, not collected and written at the end.**
  //
  // The first version pushed every row into one array and upserted after the last wiki. On
  // seven wikis that was merely invisible — nothing appeared in the queue until the whole
  // pass finished, so there was no way to watch it work. On seventy it would be worse than
  // invisible: a failure on the last wiki would discard the hours and the model calls spent
  // on the first sixty-nine, and a model call is the one thing here that cannot be repeated
  // for free.
  //
  // The buffer exists only to make batches. `place_key` is generated as
  // lower(btrim(place_name)) and the unique index is (work_id, place_key), so a batch
  // holding the same pair twice fails — the collapse below is per batch, which is where the
  // constraint actually bites. Across batches the upsert's own conflict clause handles it.
  const buffer = [];
  const sample = [];
  let written = 0;
  let failedBatches = 0;

  async function flush({ force = false } = {}) {
    if (buffer.length === 0 || (!force && buffer.length < WRITE_BATCH)) return;
    const unique = new Map();
    for (const row of buffer) unique.set(`${row.work_id}:${row.place_name.trim().toLowerCase()}`, row);
    const batch = [...unique.values()];
    buffer.length = 0;

    if (DRY_RUN) {
      for (const row of batch) if (sample.length < 12) sample.push(row);
      written += batch.length;
      return;
    }
    const { error } = await db.from("location_submissions")
      .upsert(batch, { onConflict: "work_id,place_key", ignoreDuplicates: false });
    if (error) {
      // One bad batch is not a reason to throw away the wikis still queued behind it — but
      // it is every reason to say so, loudly, and to count it into the total. A run that
      // loses rows and reports success is the failure this whole file keeps meeting.
      failedBatches += 1;
      console.log(`  !! batch of ${batch.length} failed: ${error.message}`);
      return;
    }
    written += batch.length;
    console.log(`  written ${written} so far`);
  }

  const skipped = { licence: 0, noSection: 0, noTable: 0, noWork: 0, prose: 0 };
  let proseCalls = 0;
  let proseRows = 0;

  // "cheap": every answer passes the verbatim-quote gate before it is stored, so a bad one
  // is visibly bad and costs a retry rather than becoming a fact ([[model-providers]]).
  // **A dry run still asks the model.** The first version skipped it, on the reasoning
  // that a dry run should not spend anything — which made the one thing you most want to
  // see before writing to the queue the one thing you could not see without writing to it.
  // Prose is opt-in already: `--prose N` is the consent, and `--dry-run` decides whether
  // the rows are stored, not whether they are read.
  const runtime = PROSE_LIMIT > 0 ? createModelClient(process.env, { tier: "cheap" }) : null;
  const throttle = createThrottle();
  if (PROSE_LIMIT > 0 && !runtime) console.log("prose requested but no model client is configured — tables and lists only");

  for (const wiki of WIKIS) {
    let licence;
    try {
      licence = await wikiLicence(wiki);
    } catch (error) {
      console.error(`  ${wiki}: licence unreadable (${error.message}) — skipped`);
      continue;
    }
    if (!licenceAllows(licence)) {
      skipped.licence += 1;
      console.log(`  ${wiki}: licence "${licence.text ?? "?"}" does not permit reuse — skipped`);
      continue;
    }
    console.log(`\n### ${wiki} (${licence.text})`);

    let pages = [];
    try {
      const search = await api(wiki, {
        action: "query", list: "search", srsearch: "filming location", srlimit: String(PAGE_LIMIT),
      });
      pages = (search?.query?.search ?? []).map((p) => p.title);
    } catch (error) {
      console.error(`  ${wiki}: search failed (${error.message})`);
      continue;
    }

    for (const page of pages) {
      let parsed;
      try {
        parsed = (await api(wiki, { action: "parse", page, prop: "wikitext|revid" })).parse;
      } catch { continue; }
      if (!parsed) continue;

      const section = locationSection(parsed.wikitext["*"]);
      if (!section) { skipped.noSection += 1; continue; }
      // A table if the page keeps one, otherwise a bullet list under a heading that says
      // the places in it are real. Prose is left for a pass that can afford a model.
      const table = parseLocationRows(section);

      // The work is resolved BEFORE the model is asked. A page we cannot attach to a work
      // is a page whose extraction we would pay for and then throw away.
      const work = matchWork(page, byTitle);
      if (!work) { skipped.noWork += 1; continue; }

      let made = table
        .map((row) => toSubmission(row, { work, wiki, page, revid: parsed.revid, licence: licence.text }))
        .filter(Boolean);

      // Prose only where the free path found nothing. A page with a table has already
      // given up its rows, and its table carries the story-to-shoot pairing that prose
      // does not — paying to re-read it would buy strictly less.
      // A bare "Locations" heading on a fan wiki means the world of the story, not the
      // world. Refused before the model is asked, because after is too late to save the
      // call — see `headingPromisesStoryPlaces`.
      if (!made.length && runtime && proseCalls < PROSE_LIMIT
        && !headingPromisesStoryPlaces(section.title)) {
        const prose = cleanWikitext(section.text);
        if (prose.length >= 200) {
          proseCalls += 1;
          await throttle();
          const extraction = await parseStructured({
            runtime,
            schema: wikipediaLocationsSchema,
            schemaName: "fandom_locations",
            instructions: extractionInstructions({ source: "fan wiki page", section: "section" }),
            input: buildExtractionInput({ title: work.title, year: work.year, prose, section: "Section" }),
            maxTokens: 20_000,
            timeout: 180_000,
          });
          if (!extraction.ok) {
            // A free endpoint refusing, rate-limiting or running out of tokens is an
            // ordinary outcome. Record it and take the next page rather than abandoning
            // every page still queued behind this one.
            skipped.prose += 1;
            console.log(`  ${page.slice(0, 46).padEnd(48)} prose ${extraction.reason}`);
          } else {
            const { accepted, rejected } = acceptExtraction(extraction.parsed, {
              prose,
              article: { title: page, revid: parsed.revid },
            });
            made = accepted
              .map((location) => toProseSubmission(location, { work, wiki, page, revid: parsed.revid, licence: licence.text }))
              .filter(Boolean);
            proseRows += made.length;
            // The reasons, not a count under one label. The first version printed
            // "failed the quote gate" for every rejection, which sent the diagnosis of a
            // real run looking at the wrong gate entirely.
            const why = rejected.reduce((tally, row) => {
              tally[row.reason] = (tally[row.reason] ?? 0) + 1;
              return tally;
            }, {});
            const reasons = Object.entries(why).map(([reason, count]) => `${count} ${reason}`).join(", ");
            console.log(`  ${page.slice(0, 46).padEnd(48)} ${String(made.length).padStart(3)} rows (model`
              + `${reasons ? `; dropped ${reasons}` : ""}) -> ${work.title}`);
          }
        }
      }

      if (!made.length) { skipped.noTable += 1; continue; }
      buffer.push(...made);
      await flush();
      if (table.length) console.log(`  ${page.slice(0, 46).padEnd(48)} ${String(made.length).padStart(3)} rows -> ${work.title}`);
      await new Promise((r) => setTimeout(r, 250));
    }

    // **A finished wiki is written before the next one is touched.** The size threshold
    // alone is not a guarantee: a batch of 200 is never reached on a wiki that yields
    // sixty-eight rows, so every row would still have ridden to the end of the run on the
    // first version of this. The unit that matters is not "enough rows" but "work already
    // done", and a wiki is the smallest boundary worth paying a write for.
    await flush({ force: true });
  }

  await flush({ force: true });

  console.log(`\n${written} rows from ${WIKIS.length} wikis`);
  console.log(`  skipped: ${skipped.licence} wikis on licence, ${skipped.noSection} pages with no section, `
    + `${skipped.noTable} with no readable table, ${skipped.noWork} matching no work`);

  if (DRY_RUN) {
    console.log("--dry-run: nothing written\n");
    for (const row of sample) console.log(`   ${row.source_sentence.slice(0, 150)}`);
    return;
  }
  if (failedBatches) {
    // Said last, because it is the thing a reader must not miss, and non-zero so a caller
    // watching the exit code sees it too.
    console.log(`done: ${written} candidate rows — INCOMPLETE: ${failedBatches} batch(es) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`done: ${written} candidate rows`);
}

main().catch((error) => { console.error(error); process.exit(1); });
