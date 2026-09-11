// Which Fandom wikis are worth reading, and where each work's page is.
//
// **The wiki list is not enumerable and does not need to be.** Fandom's own index
// (`/api/v1/Wikis/List`) sits behind a Cloudflare challenge and answers 403; getting past
// that would be bot-detection evasion and is not attempted. Nothing here touches it.
//
// Wikidata answers a better question anyway. Property **P6262 "Fandom article ID"** holds
// `wiki:Page_Title`, and measured 11.09 there are 206,443 such statements over 132,855
// items — of which **32,323 carry an IMDb id as well**, which is the key our `works` table
// already uses. So the join gives not a list of wikis to crawl but the exact page for a
// work we hold, which is one fetch instead of a search.
//
// Related: [[personal-library]], [[source-evaluation]], [[wikipedia-enrichment]].

export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

// **Ask about the works we hold, not about all of Wikidata.**
//
// The first version paged the whole property with LIMIT/OFFSET and the public endpoint
// answered 502 on the second page: an OFFSET over 206,443 statements re-sorts the lot on
// every request, and the second page is the one that pays for it. It was also the wrong
// question — we hold 6,044 works with an IMDb id, and the other 26,000 matches are rows to
// fetch and discard.
//
// Chunked VALUES asks only what we can use. Sixteen queries of 400 ids each replace an
// unbounded scan, and each one is cheap enough that the endpoint answers it first time.
export const IDS_PER_QUERY = 400;

export function pairsQuery(imdbIds) {
  const values = (imdbIds ?? [])
    .filter((id) => /^tt\d+$/.test(String(id ?? "")))
    .map((id) => `"${id}"`)
    .join(" ");
  return `SELECT ?imdb ?fandom WHERE {
  VALUES ?imdb { ${values} }
  ?item wdt:P345 ?imdb ; wdt:P6262 ?fandom .
}`;
}

export function chunk(items, size = IDS_PER_QUERY) {
  const out = [];
  for (let index = 0; index < (items?.length ?? 0); index += size) out.push(items.slice(index, index + size));
  return out;
}

// `wiki:Page_Title`, and the wiki half can carry a language prefix — `de.ghibli`,
// `no.norske-dubber`. Those are separate wikis with their own licences and their own
// domains, and a prefixed one is skipped rather than guessed at: `de.ghibli.fandom.com`
// is a real host but the parser's section headings are English.
export function splitFandomId(value) {
  const text = String(value ?? "").trim();
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const wiki = text.slice(0, colon);
  const page = text.slice(colon + 1).trim();
  if (!page || !/^[a-z0-9-]+$/i.test(wiki)) return null;
  return { wiki, page: page.replace(/_/g, " ") };
}

// Wikis ranked by how many of OUR works they carry a page for. This is the whole point of
// the pass: the expensive reading goes where the catalogue actually overlaps, rather than
// down a list of the biggest wikis, which is a different list entirely.
export function rankWikis(pairs, { heldImdbIds } = {}) {
  const byWiki = new Map();
  for (const pair of pairs ?? []) {
    const split = typeof pair === "string" ? splitFandomId(pair) : pair;
    if (!split?.wiki) continue;
    if (heldImdbIds && !heldImdbIds.has(split.imdb)) continue;
    if (!byWiki.has(split.wiki)) byWiki.set(split.wiki, []);
    byWiki.get(split.wiki).push(split);
  }
  return [...byWiki.entries()]
    .map(([wiki, entries]) => ({ wiki, works: entries.length, entries }))
    .sort((a, b) => b.works - a.works || a.wiki.localeCompare(b.wiki));
}

// What a probed page turned out to be. `prose` is not a failure — it is the measurement
// that says how much a model pass would be buying, and the discovery report exists to
// answer exactly that before anybody spends on it.
export function classifyPage({ section, rows }) {
  if (!section) return "no_section";
  if (rows?.length) return section.text.includes("{|") ? "table" : "list";
  return "prose";
}
