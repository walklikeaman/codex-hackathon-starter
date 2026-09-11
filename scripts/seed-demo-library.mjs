#!/usr/bin/env node
//
// Put a real Letterboxd export where the dev server can hand it to the browser, so the
// map can be tested against an actual library without importing it every time.
//
//   node scripts/seed-demo-library.mjs ~/Downloads/letterboxd-you-2026-08-04.zip
//   node scripts/seed-demo-library.mjs ~/Downloads/letterboxd-export/   # unzipped
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

import { mergeLibraries, parseMediaCsv } from "../app/lib/media-library.mjs";

const OUT = "public/demo-library.json";

async function readExport(source) {
  if (!existsSync(source)) throw new Error(`no such file or directory: ${source}`);

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

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/seed-demo-library.mjs <letterboxd .zip or unzipped folder>");
  process.exit(1);
}

const { watched, ratings } = await readExport(source);
if (!watched && !ratings) {
  console.error("Neither watched.csv nor ratings.csv found at the top level of that export.");
  process.exit(1);
}

// The same parser and the same merge the browser importer uses. A demo built by a
// different code path would test something the reader never runs.
const library = mergeLibraries(
  watched ? parseMediaCsv(watched, "letterboxd") : [],
  ratings ? parseMediaCsv(ratings, "letterboxd") : [],
);

// `public/` is not in the repo — nothing was committed to it — so it may not exist yet.
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(library));
const rated = library.filter((movie) => Number.isFinite(movie.rating)).length;
console.log(`${OUT}: ${library.length} films, ${rated} rated`);
console.log("Gitignored. `npm run dev` will offer it; production never will.");
