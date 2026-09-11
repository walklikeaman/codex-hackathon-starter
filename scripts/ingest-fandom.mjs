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
import {
  licenceAllows,
  locationSection,
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
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

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

  const rows = [];
  const skipped = { licence: 0, noSection: 0, noTable: 0, noWork: 0 };

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
      if (!table.length) { skipped.noTable += 1; continue; }

      const work = matchWork(page, byTitle);
      if (!work) { skipped.noWork += 1; continue; }

      const made = table
        .map((row) => toSubmission(row, { work, wiki, page, revid: parsed.revid, licence: licence.text }))
        .filter(Boolean);
      rows.push(...made);
      console.log(`  ${page.slice(0, 46).padEnd(48)} ${String(made.length).padStart(3)} rows -> ${work.title}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // The database's own identity, mirrored: `place_key` is generated as
  // lower(btrim(place_name)) and the unique index is (work_id, place_key). Upserting a
  // batch that contains the same pair twice fails, so the run has to collapse them first.
  const unique = new Map();
  for (const row of rows) unique.set(`${row.work_id}:${row.place_name.trim().toLowerCase()}`, row);
  const ready = [...unique.values()];

  console.log(`\n${ready.length} rows from ${WIKIS.length} wikis`);
  console.log(`  skipped: ${skipped.licence} wikis on licence, ${skipped.noSection} pages with no section, `
    + `${skipped.noTable} with no readable table, ${skipped.noWork} matching no work`);

  if (DRY_RUN) {
    console.log("--dry-run: nothing written\n");
    for (const row of ready.slice(0, 12)) console.log(`   ${row.source_sentence.slice(0, 150)}`);
    return;
  }

  let written = 0;
  for (let index = 0; index < ready.length; index += WRITE_BATCH) {
    const batch = ready.slice(index, index + WRITE_BATCH);
    const { error } = await db.from("location_submissions")
      .upsert(batch, { onConflict: "work_id,place_key", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
    written += batch.length;
    console.log(`  written ${written}/${ready.length}`);
  }
  console.log(`done: ${written} candidate rows`);
}

main().catch((error) => { console.error(error); process.exit(1); });
