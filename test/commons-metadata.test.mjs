import assert from "node:assert/strict";
import test from "node:test";

import { isDisplayable, normalizeAttribution } from "../app/lib/attribution.mjs";
import {
  buildCommonsMetadataUrl,
  commonsFileTitle,
  fetchCommonsAttribution,
  parseCommonsMetadata,
} from "../app/lib/commons-metadata.mjs";

// A real response shape, trimmed to what we read.
const PAYLOAD = {
  query: {
    pages: {
      "-1": {
        title: "File:Trafalgar Square.jpg",
        imageinfo: [{
          extmetadata: {
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Diliff" title="User:Diliff">Diliff</a>' },
            LicenseShortName: { value: "CC BY-SA 3.0" },
            LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/3.0" },
          },
        }],
      },
    },
  },
};

test("commonsFileTitle recovers the file from the URL shapes P18 produces", () => {
  assert.equal(
    commonsFileTitle("https://commons.wikimedia.org/wiki/Special:FilePath/Trafalgar%20Square.jpg?width=1200"),
    "File:Trafalgar Square.jpg",
  );
  assert.equal(
    commonsFileTitle("https://upload.wikimedia.org/wikipedia/commons/a/ab/Big_Ben.jpg"),
    "File:Big_Ben.jpg",
  );
});

test("commonsFileTitle refuses anything that is not a Wikimedia URL", () => {
  // Attributing a third-party image as Commons would be a false credit.
  assert.equal(commonsFileTitle("https://evil.example/Special:FilePath/x.jpg"), null);
  assert.equal(commonsFileTitle("not a url"), null);
  assert.equal(commonsFileTitle(null), null);
});

test("parseCommonsMetadata strips the HTML Commons wraps its fields in", () => {
  const byTitle = parseCommonsMetadata(PAYLOAD);
  const entry = byTitle.get("File:Trafalgar Square.jpg");
  assert.equal(entry.author, "Diliff"); // not the <a> tag
  assert.equal(entry.license, "CC BY-SA 3.0");
  assert.equal(entry.license_url, "https://creativecommons.org/licenses/by-sa/3.0");
  assert.match(entry.source_url, /commons\.wikimedia\.org\/wiki\//);
});

test("a parsed Commons file becomes displayable, where a bare URL did not", () => {
  // This is the point of the module: the fail-safe stops refusing once the credit
  // it requires actually exists.
  assert.equal(isDisplayable(normalizeAttribution({ source: "wikimedia" })), false);
  const entry = parseCommonsMetadata(PAYLOAD).get("File:Trafalgar Square.jpg");
  assert.equal(isDisplayable(normalizeAttribution(entry)), true);
});

test("a file missing its author or licence is returned without them, never invented", () => {
  const byTitle = parseCommonsMetadata({
    query: { pages: { "-1": { title: "File:X.jpg", imageinfo: [{ extmetadata: {} }] } } },
  });
  const entry = byTitle.get("File:X.jpg");
  assert.equal(entry.author, null);
  assert.equal(entry.license, null);
  assert.equal(isDisplayable(normalizeAttribution(entry)), false); // stays hidden
});

test("parseCommonsMetadata skips missing pages and malformed payloads", () => {
  assert.equal(parseCommonsMetadata({ query: { pages: { "-1": { title: "File:Gone.jpg", missing: "" } } } }).size, 0);
  assert.equal(parseCommonsMetadata({}).size, 0);
  assert.equal(parseCommonsMetadata(null).size, 0);
});

test("buildCommonsMetadataUrl batches and refuses an unusable set", () => {
  const url = buildCommonsMetadataUrl(["File:A.jpg", "File:B.jpg", "File:A.jpg"]);
  assert.equal(url.searchParams.get("titles"), "File:A.jpg|File:B.jpg"); // deduped
  assert.equal(url.searchParams.get("iiprop"), "extmetadata");
  assert.throws(() => buildCommonsMetadataUrl([]), /between 1 and 50/);
});

test("fetchCommonsAttribution maps results back to the original image urls", async () => {
  const fetchImpl = async () => new Response(JSON.stringify(PAYLOAD), { status: 200 });
  const byUrl = await fetchCommonsAttribution(
    ["https://commons.wikimedia.org/wiki/Special:FilePath/Trafalgar%20Square.jpg"],
    { fetchImpl },
  );
  const entry = byUrl.get("https://commons.wikimedia.org/wiki/Special:FilePath/Trafalgar%20Square.jpg");
  assert.equal(entry.author, "Diliff");
});

test("a filename containing a comma survives the round trip", async () => {
  // Real Commons files look like "Trafalgar Square, London 2 - Jun 2009.jpg".
  // A comma-separated urls param tears that in half and finds nothing.
  const url = "https://commons.wikimedia.org/wiki/Special:FilePath/Trafalgar%20Square,%20London%202%20-%20Jun%202009.jpg";
  assert.equal(commonsFileTitle(url), "File:Trafalgar Square, London 2 - Jun 2009.jpg");

  const params = new URLSearchParams();
  params.append("url", url);
  assert.equal(params.getAll("url")[0], url); // intact, comma and all
});

test("fetchCommonsAttribution never calls out for non-Commons urls", async () => {
  let called = false;
  const byUrl = await fetchCommonsAttribution(["https://image.tmdb.org/t/p/w500/a.jpg"], {
    fetchImpl: async () => { called = true; return new Response("{}"); },
  });
  assert.equal(called, false);
  assert.equal(byUrl.size, 0);
});
