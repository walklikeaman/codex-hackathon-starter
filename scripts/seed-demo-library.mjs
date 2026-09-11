#!/usr/bin/env node
//
// Put a real export where the dev server can hand it to the browser, so the map can be
// tested against an actual library without importing it every time.
//
//   node scripts/seed-demo-library.mjs ~/Downloads/imdb-ratings.csv        # IMDb
//   node scripts/seed-demo-library.mjs ~/Downloads/letterboxd-you.zip      # Letterboxd
//   node scripts/seed-demo-library.mjs ~/Downloads/letterboxd-export/      # unzipped
//
// **Three shapes, because the two services hand you different things.** Letterboxd gives a
// ZIP of several CSVs, of which watched.csv and ratings.csv matter. IMDb gives one CSV per
// list, and the ratings list is the one worth seeding — it holds only the titles you
// scored, so every row carries an opinion. The source is read off the file rather than
// asked for: an IMDb export's header starts with `Const`, a Letterboxd one does not.
//
// **The file it writes is gitignored, and that is the point.** A watch history is personal
// — 2,422 films, dated, rated — and this repository is public. It is generated on the
// machine that needs it and never committed; anybody else who wants the demo runs this with
// their own export.
//
// It is also DEV ONLY on the reading side: `DemoLibrary` refuses to seed anything in
// production, so a deploy can never ship somebody's list.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import JSZip from "jszip";

import { RATING_SCALE, mergeLibraries, parseMediaCsv } from "../app/lib/media-library.mjs";

const OUT = "public/demo-library.json";

// Which service wrote this CSV. IMDb keys every row by `Const` (the tt id) and puts it
// first; Letterboxd's exports lead with `Date`. Guessing wrong would not fail loudly — it
// would put the numbers on the wrong scale, which is the whole thing `RATING_SCALE` exists
// to prevent — so it is decided by the header rather than by the filename, which for an
// IMDb export is a bare UUID.
export function sourceOfCsv(text) {
  const header = String(text ?? "").split(/\r?\n/, 1)[0].replace(/^\uFEFF/, "").toLowerCase();
  if (/(^|,)\s*"?const"?\s*(,|$)/.test(header)) return "imdb";
  if (/letterboxd uri/.test(header)) return "letterboxd";
  return null;
}

async function readExport(source) {
  if (!existsSync(source)) throw new Error(`no such file or directory: ${source}`);

  if (source.toLowerCase().endsWith(".csv")) {
    const text = readFileSync(source, "utf8");
    const service = sourceOfCsv(text);
    if (!service) {
      throw new Error("That CSV is neither an IMDb export (a `Const` column) nor a Letterboxd one (a `Letterboxd URI` column).");
    }
    return { csv: text, service };
  }

  if (statSync(source).isDirectory()) {
    const read = (name) => {
      const file = path.join(source, name);
      return existsSync(file) ? readFileSync(file, "utf8") : "";
    };
    return { watched: read("watched.csv"), ratings: read("ratings.csv") };
  }

  const zip = await JSZip.loadAsync(readFileSync(source));
  // The importer looks for these at the ROOT, and so does this — a ZIP with a nested
  // folder is the gotcha [[personal-library]] already names.
  return {
    watched: (await zip.file("watched.csv")?.async("text")) ?? "",
    ratings: (await zip.file("ratings.csv")?.async("text")) ?? "",
  };
}

// The CLI, behind the same guard the other scripts use, so a test can import
// `sourceOfCsv` without the module running itself and exiting.
async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: node scripts/seed-demo-library.mjs <imdb .csv, letterboxd .zip, or unzipped folder>");
    process.exit(1);
  }

  const exported = await readExport(source);
  if (!exported.csv && !exported.watched && !exported.ratings) {
    console.error("Neither watched.csv nor ratings.csv found at the top level of that export.");
    process.exit(1);
  }

  // The same parser and the same merge the browser importer uses. A demo built by a
  // different code path would test something the reader never runs — which is also what
  // puts the ratings on the ten-point scale here, since the parser is where that happens.
  const library = exported.csv
    ? mergeLibraries([], parseMediaCsv(exported.csv, exported.service))
    : mergeLibraries(
      exported.watched ? parseMediaCsv(exported.watched, "letterboxd") : [],
      exported.ratings ? parseMediaCsv(exported.ratings, "letterboxd") : [],
    );

  // `public/` is not in the repo — nothing was committed to it — so it may not exist yet.
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(library));
  const rated = library.filter((movie) => Number.isFinite(movie.rating)).length;
  console.log(`${OUT}: ${library.length} films, ${rated} rated out of ${RATING_SCALE}`);
  console.log("Gitignored. `npm run dev` will offer it; production never will.");
}

if (process.argv[1]?.endsWith("seed-demo-library.mjs")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
