// The inverted search: find PLACES whose own article mentions a WORK.
//
// Every other path in this project asks "where does this work take us" and reads the
// work's article. That misses an entire category — the fact that lives on the place's
// page and nowhere else. The motivating case: Thomas Riddell's grave in Greyfriars
// Kirkyard, Edinburgh, named as the possible origin of a Harry Potter character. It
// appears in no Production section and no filming permit. It is a bullet in a list of
// burials, in the graveyard's own article, carrying a `<ref>` to a book.
//
// Three things had to be right, and each was found by measurement rather than reasoning.
//
// 1. FILTER GEOGRAPHICALLY IN THE QUERY, not after it. Searching the work's name and
//    then keeping the results that happen to have coordinates wastes the whole retrieval
//    budget: `insource:"Lord Voldemort"` returns 50 articles of which 2 are places.
//    CirrusSearch's `nearcoord:` does it in the engine — measured, 10 of 10 and 6 of 6
//    results carried coordinates.
//
// 2. USE THE REGEX FORM OF insource. `insource:"Rowling"` and `insource:/Rowling/` are
//    different operators: the quoted one matches tokens and misses "Rowling's", the
//    regex one matches the raw source. The quoted form finds nothing in Greyfriars; the
//    regex form finds it.
//
// 3. FAN OUT TO THE WORK'S ENTITIES. Neither "Harry Potter" nor "Rowling" reaches
//    Greyfriars — the article links to [[Lord Voldemort]] and names no one else. A
//    search by title alone finds nothing, which is why the title is the wrong key.
//
// Together: `insource:/Lord Voldemort/ nearcoord:15km,55.9533,-3.1883` returns exactly
// one article, and it is the right one.

import { WIKIDATA_SPARQL } from "./geocode-wikidata.mjs";
import { finiteOrNull } from "./numbers.mjs";

// Properties that name something a place's article might plausibly mention: the
// characters, who made it, what series it belongs to, what it was based on.
//
// `P674 characters` is the one that matters most and the one a title search cannot
// reach. Verified on Harry Potter: it yields Lord Voldemort, Dumbledore, McGonagall.
const FANOUT_PROPERTIES = ["P674", "P50", "P57", "P170", "P179", "P144"];

// Who MADE the work, as opposed to who is in it. The distinction decides the order the
// names are spent in — see `namesFromFanout`.
const CREATOR_PROPERTIES = new Set(["P50", "P57", "P170"]);

// Two things are asked for alongside the label, and both were added after a live run
// lost something that mattered.
//
// `?article` — the English Wikipedia title — because THE ENGLISH LABEL CAN SIMPLY BE
// MISSING. Q34660 is J. K. Rowling; today that item has labels in dozens of languages
// and none in English, so `?nameLabel` comes back as the bare string "Q34660" and the
// author's name — the one that finds the café she wrote in — is silently dropped. The
// sitelink still says "J. K. Rowling".
//
// `?human` — because a real person and a character are worth different amounts here,
// and Outlander proves it: its P674 characters include George Washington, Louis XV and
// Simon Fraser, 11th Lord Lovat. Those names are in Scottish place articles for reasons
// that have nothing to do with the series, they filled all six branches of the query,
// and the search returned zero. Claire and Jamie Fraser, who are only ever mentioned
// because of the show, had been cut by the cap.
// `?fame` is how many Wikipedias have an article about the name. It is the ordering
// signal inside each class, and it must be the PRECOMPUTED `wikibase:sitelinks` rather
// than a COUNT over sitelinks: same numbers, and measured on Philosopher's Stone —
// 39 entities — 698 ms against 2,765 ms. This runs while somebody waits for a map.
export function buildEntityFanoutQuery(workQid) {
  if (!/^Q[1-9]\d*$/.test(String(workQid ?? ""))) return null;
  const properties = FANOUT_PROPERTIES.map((property) => `wdt:${property}`).join(" ");
  return `SELECT DISTINCT ?nameLabel ?article ?human ?p ?fame WHERE {
  VALUES ?work { wd:${workQid} }
  VALUES ?p { ${properties} }
  ?work ?p ?name .
  OPTIONAL {
    ?sitelink schema:about ?name ;
              schema:isPartOf <https://en.wikipedia.org/> ;
              schema:name ?article .
  }
  OPTIONAL { ?name wikibase:sitelinks ?fame . }
  BIND(EXISTS { ?name wdt:P31 wd:Q5 } AS ?human)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 60`;
}

// An article title carries a disambiguator the prose never does: the page is
// "Harry Potter (character)" and no sentence anywhere says that. Only the trailing one
// is removed, so a name that is genuinely parenthetical keeps its shape.
function nameFromArticle(article) {
  return String(article ?? "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

// The fan-out, in the order the six branches should be spent.
//
// Ordering is not a nicety — the cap is a real budget, and unordered it spent that
// budget on the wrong names twice, in opposite ways.
//
// THE CLASSES. Fictional characters first: their names are near-unique in running
// prose, so a place article naming Claire Fraser is telling us about the show. Then the
// people who MADE the work, which is the whole "written here" half of the product — the
// Elephant House's article says Rowling, not Hermione. Real people who merely appear as
// characters go last, because George Washington in a Scottish article is usually about
// George Washington.
//
// FAME, WITHIN A CLASS, POINTS IN OPPOSITE DIRECTIONS. For an invented name it is pure
// signal: Wikidata returns Harry Potter's characters in no particular order, and the six
// branches went to Ginny, Snape, Lily, Hermione, Ron and Dumbledore — Lord Voldemort,
// the ONLY one of those names in Greyfriars Kirkyard's article, was ninth. Ranked by how
// many Wikipedias carry the character, Voldemort is fifth and the grave comes back.
// Verified on both the series and Philosopher's Stone.
//
// For a real person fame is the opposite. Outlander's characters include George
// Washington (273 sitelinks) and Simon Fraser, 11th Lord Lovat (9); Washington's name is
// in articles for his own reasons, Lovat's is much closer to being about the show. So
// the obscure real person is the discriminating one, and that class is ranked upward.
export function namesFromFanout(payload) {
  const rows = payload?.results?.bindings;
  if (!Array.isArray(rows)) return [];

  const ranked = rows.map((row) => {
    const label = String(row?.nameLabel?.value ?? "").trim();
    // A bare Q-id means the label service had nothing; the sitelink is the fallback.
    const name = /^Q[1-9]\d*$/.test(label) ? nameFromArticle(row?.article?.value) : label;
    const property = String(row?.p?.value ?? "").split("/").pop();
    const human = row?.human?.value === "true";
    const rank = !human ? 0 : (CREATOR_PROPERTIES.has(property) ? 1 : 2);
    const fame = Number(row?.fame?.value);
    return {
      name,
      rank,
      // An item with no sitelink count sorts as the least famous of its class, which is
      // the safe end for a real person and the honest one for an invented name nobody
      // has written about.
      fame: Number.isFinite(fame) ? fame : 0,
    };
  });

  const seen = new Set();
  return ranked
    .filter((entry) => isSearchableEntity(entry.name))
    .sort((left, right) => left.rank - right.rank
      || (left.rank === 2 ? left.fame - right.fame : right.fame - left.fame)
      || left.name.localeCompare(right.name))
    .filter((entry) => {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => entry.name);
}

export { WIKIDATA_SPARQL };

// A name worth searching for.
//
// A one-word name drags back every article containing that word; the geographic filter
// keeps the result set small but the RELEVANCE is what suffers, because "Harry" matches
// a thousand unrelated sentences. A full name is a near-unique string in running prose,
// which is exactly what makes this work.
export const MIN_ENTITY_WORDS = 2;

export function isSearchableEntity(name) {
  const text = String(name ?? "").trim();
  // A bare Q-id is a label the service failed to resolve; searching for it finds nothing.
  if (/^Q[1-9]\d*$/.test(text)) return false;
  if (text.length < 6) return false;
  return text.split(/\s+/).filter(Boolean).length >= MIN_ENTITY_WORDS;
}

// Escape for a CirrusSearch `insource:/…/` regex. An unescaped metacharacter does not
// merely fail to match — it changes what is asked, and a name like "Q. and the Bomb"
// carries three of them.
export function escapeInsourceRegex(name) {
  return String(name ?? "").replace(/[\\/.*+?^${}()|[\]-]/g, "\\$&");
}

// How many entities one search may carry. Each is an OR branch and CirrusSearch charges
// for every one; six full names is already a wide net over a single city.
export const MAX_ENTITIES_PER_QUERY = 6;

// The radius comes from the city the user is looking at. Unlike the work search — where
// a radius was the wrong question entirely — here it IS the question: this asks what in
// THIS place is connected to the work.
export function buildInvertedSearch({ names, center, radiusKm = 15 }) {
  // Deduplicated BEFORE the cap, because a repeat costs a branch and the branches are
  // the whole budget. Measured: a work's title is usually also the name of its main
  // character, so "Harry Potter" arrived twice, pushed Lord Voldemort out of the six —
  // and Voldemort is the only one of those names that Greyfriars Kirkyard's article
  // contains. The duplicate, on its own, lost the case this module was written for.
  const seen = new Set();
  const wanted = (Array.isArray(names) ? names : [])
    .filter(isSearchableEntity)
    .filter((name) => {
      const key = String(name).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ENTITIES_PER_QUERY);
  if (wanted.length === 0) return null;

  const lat = finiteOrNull(center?.lat);
  const lng = finiteOrNull(center?.lng);
  if (lat === null || lng === null) return null;
  // CirrusSearch rejects a radius outside its own bounds rather than clamping.
  const radius = Math.min(Math.max(Math.round(radiusKm), 1), 500);

  // The alternation goes INSIDE one regex. CirrusSearch's own `OR` between separate
  // insource clauses silently returns nothing — not an error, zero results — while the
  // same names in one alternation return the right article. Measured all four forms:
  //
  //   insource:/A/ nearcoord:…                        → 1 (correct)
  //   insource:/A/ OR insource:/B/ nearcoord:…        → 0
  //   (nearcoord:…) (insource:/A/ OR insource:/B/)    → 0
  //   nearcoord:… insource:/A|B/                      → 1 (correct)
  //
  // Each name is escaped first, so a `|` inside a name cannot become an alternation.
  const pattern = wanted.map(escapeInsourceRegex).join("|");
  return `nearcoord:${radius}km,${lat.toFixed(4)},${lng.toFixed(4)} insource:/${pattern}/`;
}

export function buildSearchUrl(query, { language = "en", limit = 20 } = {}) {
  if (!query) return null;
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", query);
  url.searchParams.set("gsrlimit", String(Math.min(limit, 50)));
  // Coordinates come back with the page, so a result that cannot be placed is visible
  // immediately rather than after a second round trip.
  //
  // `pageterms` comes back with it too, and it is what lets a candidate be GRADED. A
  // Wikipedia hit has no P31 and would otherwise be typeless — which put Edinburgh on
  // the live map as a dot, the exact failure the precision axis exists to prevent. The
  // short description ("capital city of Scotland", "cemetery in Edinburgh") is the only
  // statement of what the place IS that this search can see, and it costs no request.
  url.searchParams.set("prop", "coordinates|info|pageterms");
  url.searchParams.set("wbptterms", "description");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  return url.toString();
}

// Candidate places from a search response. A page without a coordinate is dropped: the
// whole point of `nearcoord:` is that these should not occur, and one that does is a
// page we cannot put on a map.
export function candidatesFromSearch(payload) {
  const pages = payload?.query?.pages;
  if (!Array.isArray(pages)) return [];

  return pages
    .map((page) => {
      const [coordinate] = page?.coordinates ?? [];
      // `finiteOrNull`, not `Number.isFinite(Number(x))`: Number("") is 0, and 0 is
      // finite — the coercion that has put places at Null Island in this codebase
      // before, and which this module's own test caught it doing again.
      const lat = finiteOrNull(coordinate?.lat);
      const lng = finiteOrNull(coordinate?.lon);
      if (lat === null || lng === null) return null;
      return {
        title: page.title,
        pageid: page.pageid,
        lat,
        lng,
        description: page?.terms?.description?.[0] ?? null,
      };
    })
    .filter(Boolean);
}
