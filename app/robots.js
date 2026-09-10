// robots.txt — the one file a crawler asks for by name (#158).
//
// Everything the directory built is reachable only if something says it exists. The
// sitemap says it, and until now nothing said the sitemap: `generateSitemaps` serves 27
// files at /sitemap/<letter>.xml and there is no /sitemap.xml among them, so a crawler
// arriving at the root had no way to learn any of the 27. Measured on production 10.09,
// before this file: /robots.txt 404, /sitemap.xml 404, /sitemap/a.xml 200 with 498 URLs.
//
// **Nothing is disallowed, and that is a decision rather than an omission.** The obvious
// line to write is `Disallow: /api/` — 31 route handlers that answer JSON and are not
// pages. But Google's renderer obeys robots.txt for the requests a PAGE makes too, and the
// map at `/` is a client component that fetches `/api/catalogue` after it mounts. Blocking
// the prefix would leave the crawler looking at an empty map on the one page that is the
// product. None of these endpoints is linked from any page, so the rule would have bought
// nothing and cost the home page.

import { SITE_URL } from "./lib/site-url.mjs";

export default function robots() {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    // One line rather than 27: the index is the list, and a list kept in two places is two
    // lists that will disagree the day a letter is added.
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
