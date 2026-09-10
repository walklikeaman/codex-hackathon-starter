// The sitemap index (#158): the document that says the other 27 exist.
//
// `generateSitemaps` splits the catalogue one file per letter and Next serves them at
// /sitemap/<id>.xml — and, with the split in place, serves nothing at /sitemap.xml at all.
// So the split that keeps each file small also made the whole set undiscoverable: 27 files
// and no document naming them, which is the same failure the sitemap was written to fix.
//
// The list comes from `generateSitemaps()` itself rather than from a second walk over the
// alphabet. A file this index does not name is a file nothing crawls, and a file it names
// that Next does not serve is a 404 handed to a crawler — both are what a second copy of
// the list produces the day a letter is added.

import { SITE_URL } from "../lib/site-url.mjs";
import { generateSitemaps } from "../sitemap.js";

// Nothing here reads a request or a database: the index is 27 lines derived from a frozen
// alphabet, so it is built once at deploy time rather than on every crawl.
export const dynamic = "force-static";

export function GET() {
  // No XML escaping, and it is safe to say so: every id is a single a-z letter or the word
  // `other`. The one bucket that could have carried a character needing an escape is '#',
  // and it already travels as `other` because a '#' in a URL never reaches the server.
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...generateSitemaps().map(({ id }) => `  <sitemap><loc>${SITE_URL}/sitemap/${id}.xml</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
      // The files behind it are regenerated on deploy; the index itself only changes when
      // the alphabet does, which has happened once.
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
