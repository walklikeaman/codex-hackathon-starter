// Reading filming locations out of Wikipedia prose (#47).
//
// Wikidata's P915 covers a few thousand films. Thousands more describe where they were
// shot only in the "Production" section of their article. That is a large, legal
// expansion — and it is also the first path where a place enters our graph without a
// canonical statement behind it, so everything here is built to arrive as `pending`.
//
// The constraints below were verified against the live APIs and the licence texts, not
// recalled. Several are the opposite of what a reasonable guess would be:
//
//   * A missing or library-default User-Agent gets HTTP 403 from Wikimedia. Not a
//     throttle — a refusal.
//   * `action=parse&section=` takes the section's `index`, and `index` is NOT `number`.
//     On "Lost in Translation (film)" Production is index 8 and number 4; passing the
//     number silently returns different prose, which is worse than an error.
//   * Wikimedia returns errors with HTTP 200 and an `error` key in the body, so
//     checking the status code alone reports success on a missing article.
//   * `prop=sections` is deprecated in favour of `prop=tocdata`.

import { integerOrNull } from "./numbers.mjs";

// One identity for every outbound call. Wikimedia requires a real contact; a
// placeholder domain is itself a policy violation, and copying a browser's UA is
// treated as malicious rather than merely rude.
export const USER_AGENT =
  "GloryMap/1.0 (https://codex-hackathon-starter.vercel.app/; nakonechnyi.n@gmail.com) node-fetch/3";

// How far behind a replica may be before we agree to be turned away.
//
// maxlag exists so that bots stop hammering the databases during trouble, and honouring
// it is not optional. But five seconds — the value for a bot making EDITS — turns this
// job away for a reason that protects nothing: we read article titles and sitelinks,
// which change on the scale of years, so a replica eight seconds behind serves us data
// that is byte-for-byte what a fresh one would. Measured live, routine lag sits around
// 8s (x-database-lag: 8, retry-after: 5) and never clears at five.
//
// A real incident is minutes behind, not seconds, and this still backs off from that.
export const MAX_DATABASE_LAG_SECONDS = 30;

// 30% of the documented 200/min ceiling. The ceiling itself carries a "subject to
// change" note, so it is deliberately not hardcoded as the target — and this job has
// no deadline that justifies running near a limit.
export const REQUESTS_PER_MINUTE = 60;
export const MIN_REQUEST_GAP_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE);

export const WIKIPEDIA_LICENSE = Object.freeze({
  name: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
});

// Sections worth reading, best first. The h2 "Production" is preferred over its
// "Filming" child because MediaWiki returns the whole subtree — asking for the child
// throws away the siblings that usually carry the location prose.
const SECTION_RANK = [
  "production",
  "filming",
  "principal photography",
  "filming locations",
  "locations and sets",
  "pre-production",
  "development",
];

export function buildEntitiesUrl(qids) {
  const ids = [...new Set(qids ?? [])].filter((id) => /^Q[1-9]\d*$/.test(id));
  if (ids.length === 0 || ids.length > 50) return null; // the API's own batch ceiling
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", ids.join("|"));
  url.searchParams.set("props", "sitelinks/urls");
  url.searchParams.set("sitefilter", "enwiki");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("maxlag", String(MAX_DATABASE_LAG_SECONDS));
  return url.toString();
}

export function articleTitleFromEntity(entity) {
  const title = entity?.sitelinks?.enwiki?.title;
  // No article means skip the work. A constructed title would land on the wrong page
  // or a disambiguation, and be indistinguishable from a real answer.
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

export function buildTocUrl(title) {
  if (typeof title !== "string" || !title.trim()) return null;
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", title.trim());
  // `revid` must be asked for explicitly. The docs read as though action=parse
  // returns it anyway; it does not, and without it the permalink cannot be pinned —
  // which is the one field that fixes which licence version the text was under.
  url.searchParams.set("prop", "tocdata|revid"); // `sections` is deprecated
  url.searchParams.set("redirects", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("maxlag", String(MAX_DATABASE_LAG_SECONDS));
  return url.toString();
}

export function buildSectionUrl(title, index) {
  const sectionIndex = String(index ?? "").trim();
  if (!title || !/^\d+$/.test(sectionIndex)) return null;
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", title);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("section", sectionIndex);
  url.searchParams.set("redirects", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("maxlag", String(MAX_DATABASE_LAG_SECONDS));
  return url.toString();
}

// Which section to read. Returns the `index`, never the `number` — see the header.
export function chooseSection(tocdata) {
  const sections = tocdata?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return null;

  const rankOf = (line) => {
    const text = String(line ?? "").toLowerCase().trim();
    const rank = SECTION_RANK.findIndex((name) => text === name || text.includes(name));
    return rank === -1 ? Infinity : rank;
  };

  // An h2 outranks a deeper heading with the same name, because its subtree contains
  // everything below it.
  const best = sections
    .map((section) => ({ section, rank: rankOf(section.line), level: Number(section.hLevel) || 9 }))
    .filter((entry) => entry.rank !== Infinity)
    .sort((a, b) => (a.rank - b.rank) || (a.level - b.level))[0];

  if (!best) return null;
  const index = String(best.section.index ?? "");
  return /^\d+$/.test(index)
    ? { index, line: best.section.line, level: best.level }
    : null;
}

// Wikimedia answers a missing page with HTTP 200 and an `error` object, so a status
// check alone reports success for an article that does not exist.
export function apiError(payload) {
  const error = payload?.error;
  if (!error) return null;
  return error.code ? `${error.code}: ${error.info ?? ""}`.trim() : "unknown api error";
}

// Not every 200-with-an-error-body means the same thing, and treating them alike threw
// away a whole enrichment run over eight seconds of replica lag.
//
//   * missingtitle, invalidtitle — permanent. The page does not exist; asking again
//     produces the same answer, so the work is skipped.
//   * maxlag, readonly, ratelimited — temporary, and in the maxlag case it is the API
//     answering the politeness WE asked for: we send maxlag ourselves, so being told a
//     replica is behind is the signal to come back shortly, not a failure.
const RETRYABLE_API_ERRORS = new Set(["maxlag", "readonly", "ratelimited"]);

export function isRetryableApiError(payload) {
  const code = payload?.error?.code;
  return typeof code === "string" && RETRYABLE_API_ERRORS.has(code);
}

// How long to wait, taken from the response rather than guessed. Wikimedia sends
// Retry-After with a maxlag breach and with 429/503, and it is the source of truth.
export function retryAfterMs(response, fallbackMs = 5000) {
  const header = Number(response?.headers?.get?.("retry-after"));
  return Number.isFinite(header) && header > 0 ? header * 1000 : fallbackMs;
}

// A bound, so a service that is lagged indefinitely fails loudly instead of looping.
export const MAX_RETRY_ATTEMPTS = 5;

// --- text ---------------------------------------------------------------------

// Third-party quoted material Wikipedia carries under its OWN fair-use policy. It is
// NOT CC BY-SA, so the licence gives us nothing for it — a director's interview quote
// republished in a commercial app has no permission behind it at all. Removed before
// any sentence is considered, rather than filtered at display time.
const NON_FREE_BLOCKS = [
  /<blockquote[\s\S]*?<\/blockquote>/gi,
  /\{\{\s*(?:quote|blockquote|cquote|quotation)\b[\s\S]*?\}\}/gi,
];

export function stripNonFreeQuotes(wikitext) {
  let text = String(wikitext ?? "");
  for (const pattern of NON_FREE_BLOCKS) text = text.replace(pattern, " ");
  return text;
}

// Wikitext → readable prose. Order matters: references and files must go before
// template stripping, or their contents leak out as loose text.
export function cleanWikitext(wikitext) {
  let text = stripNonFreeQuotes(wikitext);

  text = text
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<ref[\s\S]*?<\/ref>/gi, " ")
    .replace(/\{\|[\s\S]*?\|\}/g, " ");        // tables

  // File links contain nested [[…]] in their captions, so a lazy match stops at the
  // FIRST closing pair and leaves a stray "]]" in the prose — seen live on
  // "Lost in Translation (film)". Consume them innermost-first instead.
  for (let pass = 0; pass < 6 && /\[\[(?:File|Image):/i.test(text); pass += 1) {
    text = text.replace(/\[\[(?:File|Image):(?:[^[\]]|\[\[[^\]]*\]\])*\]\]/gi, " ");
  }

  // Templates nest, so strip repeatedly until it settles rather than once.
  for (let pass = 0; pass < 6 && /\{\{/.test(text); pass += 1) {
    text = text.replace(/\{\{[^{}]*\}\}/g, " ");
  }

  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")  // [[A|B]] → B
    .replace(/\[\[([^\]]+)\]\]/g, "$1")             // [[A]]   → A
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/'''?/g, "")
    // Headings are their own line. Stripping the = marks in place glued the next
    // heading onto the previous one — "ProductionDevelopment" — which then reads as
    // one word to both a person and a model.
    .replace(/^\s*={2,}\s*(.+?)\s*={2,}\s*$/gm, "\n$1.\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A quote may be stored, but kept short: one sentence. This is not a legal safe
// harbour — no word count creates one — it simply keeps every quote obviously inside
// any quotation exception, so the attribution we render is belt-and-braces.
export const MAX_QUOTE_WORDS = 30;

export function isStorableQuote(quote) {
  const text = String(quote ?? "").trim();
  if (!text) return false;
  if (text.split(/\s+/).length > MAX_QUOTE_WORDS) return false;
  // More than one sentence means it is a passage, not a citation.
  return (text.match(/[.!?](\s|$)/g) ?? []).length <= 1;
}

// --- attribution ----------------------------------------------------------------

// Pinning the revision is the highest-value field here: it makes the credit point at
// the exact text copied, and it settles which licence version applies — revisions
// after 7 June 2023 are unambiguously 4.0.
//
// `integerOrNull` rather than `Number.isInteger(Number(revid))`: `Number(null)` is 0
// and 0 is an integer, so the naive check happily builds `oldid=null` — the same
// coercion that put places at Null Island four times before numbers.mjs existed.
export function permalink(title, revid) {
  const revision = integerOrNull(revid);
  if (!title || revision === null || revision <= 0) return null;
  const url = new URL("https://en.wikipedia.org/w/index.php");
  url.searchParams.set("title", String(title).replace(/ /g, "_"));
  url.searchParams.set("oldid", String(revision));
  return url.toString();
}

// Both halves are required and are separate obligations: crediting the author (the
// article) and giving the licensing notice (naming CC BY-SA and linking it). Shipping
// only "Source: Wikipedia" plus a link is the common failure and is non-compliant.
export function wikipediaAttribution({ title, revid, modified = false }) {
  if (!title) return null;
  return {
    source: "wikipedia",
    label: `Wikipedia, "${title}"`,
    article_url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, "_"))}`,
    permalink: permalink(title, revid),
    revid: integerOrNull(revid),
    license: WIKIPEDIA_LICENSE.name,
    license_url: WIKIPEDIA_LICENSE.url,
    modified: Boolean(modified),
    // Rendered wherever the quote is shown — not on an About page, because public
    // display is what the licence calls Sharing.
    notice: `Source: Wikipedia, "${title}" — ${WIKIPEDIA_LICENSE.name}${modified ? " (modified)" : ""}`,
  };
}
