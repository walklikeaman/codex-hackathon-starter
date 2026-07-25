import assert from "node:assert/strict";
import test from "node:test";

import {
  creditLine,
  isDisplayable,
  licenseUrl,
  normalizeAttribution,
  requiredNotices,
  sourceFromUrl,
} from "../app/lib/attribution.mjs";

test("sourceFromUrl recognises the hosts we actually render", () => {
  assert.equal(sourceFromUrl("https://image.tmdb.org/t/p/w500/abc.jpg"), "tmdb");
  assert.equal(sourceFromUrl("https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg"), "wikimedia");
  assert.equal(sourceFromUrl("https://upload.wikimedia.org/x.jpg"), "wikimedia");
  assert.equal(sourceFromUrl("https://images.unsplash.com/photo-1"), "unsplash");
});

test("sourceFromUrl returns null for anything it cannot vouch for", () => {
  // A guess here would put an unattributed image on screen, which is the whole
  // thing this module exists to prevent.
  assert.equal(sourceFromUrl("https://evil.example/photo.jpg"), null);
  assert.equal(sourceFromUrl("not a url"), null);
  assert.equal(sourceFromUrl(null), null);
});

test("a per-file licensed image without author or licence is NOT displayable", () => {
  // Commons is licensed per file: republishing without the credit its licence
  // requires is a licence breach, not a missing caption.
  const missingBoth = normalizeAttribution({ source: "wikimedia" });
  assert.equal(isDisplayable(missingBoth), false);

  const missingLicense = normalizeAttribution({ source: "wikimedia", author: "Jane Doe" });
  assert.equal(isDisplayable(missingLicense), false);

  const complete = normalizeAttribution({
    source: "wikimedia", author: "Jane Doe", license: "CC BY-SA 4.0",
  });
  assert.equal(isDisplayable(complete), true);
});

test("TMDB artwork is displayable without a per-file licence but carries its notice", () => {
  // TMDB licenses the art from the studios; there is no per-file licence to name,
  // but their terms require the explicit non-endorsement wording.
  const tmdb = normalizeAttribution({ url: "https://image.tmdb.org/t/p/w500/a.jpg" });
  assert.equal(tmdb.source, "tmdb");
  assert.equal(isDisplayable(tmdb), true);
  assert.match(tmdb.notice, /not endorsed or certified by TMDB/);
});

test("an unknown source is never displayable", () => {
  assert.equal(normalizeAttribution({ source: "some-blog" }), null);
  assert.equal(isDisplayable(null), false);
  assert.equal(isDisplayable({ source: "some-blog" }), false);
});

test("licenceUrl resolves the well-known licences so a credit is verifiable", () => {
  assert.equal(licenseUrl("CC BY-SA 4.0"), "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(licenseUrl("cc0"), "https://creativecommons.org/publicdomain/zero/1.0/");
  assert.equal(licenseUrl("something custom"), null);
});

test("normalizeAttribution keeps an explicit licence url when the licence is unknown to us", () => {
  const custom = normalizeAttribution({
    source: "mapillary", author: "A Contributor",
    license: "Mapillary Terms", license_url: "https://www.mapillary.com/terms",
  });
  assert.equal(custom.license_url, "https://www.mapillary.com/terms");
  assert.equal(isDisplayable(custom), true);
});

test("creditLine reads as a sentence a human can check", () => {
  assert.equal(
    creditLine(normalizeAttribution({ source: "wikimedia", author: "Jane Doe", license: "CC BY-SA 4.0" })),
    "Wikimedia Commons · Jane Doe · CC BY-SA 4.0",
  );
  assert.equal(creditLine(normalizeAttribution({ source: "tmdb" })), "TMDB");
  assert.equal(creditLine(null), "");
});

test("requiredNotices lists each notice once per page", () => {
  const tmdbA = normalizeAttribution({ source: "tmdb" });
  const tmdbB = normalizeAttribution({ source: "tmdb" });
  const commons = normalizeAttribution({ source: "wikimedia", author: "X", license: "CC0" });
  const notices = requiredNotices([tmdbA, tmdbB, commons]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /TMDB/);
});
