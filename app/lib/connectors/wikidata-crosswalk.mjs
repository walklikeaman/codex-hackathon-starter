// External-id → Wikidata QID cross-walk. A work in our graph is keyed by an
// external id (tmdb/imdb/isbn/mbid); the Location Resolution Engine (Step 2) needs
// its Wikidata entity to read filming/narrative locations. This maps ids → QIDs in
// one batched SPARQL round-trip.
//
// Pure-by-default (buildCrosswalkSparql / parseCrosswalkResults / resolveWorkQids)
// with an OPTIONAL injectable fetch wrapper (crosswalkWikidataIds), mirroring the
// letterboxd-rss.mjs (pure) / route (fetch) split. Property ids and value formats
// were live-verified against query.wikidata.org (see the property table below).
//
// Injection defense: the caller never chooses the SPARQL property — it comes from a
// hard-coded id-type→P-id allow-list. Every value is validated before it is
// interpolated: a format regex per id type, then a final gate that rejects the only
// characters able to terminate or escape a SPARQL "..." literal. buildCrosswalkSparql
// re-checks both as defense in depth.

import { isWikidataId, wikidataId } from "../location-search.mjs";

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/)";

// Wikidata reverse-lookup properties, verified live:
//   P4947 TMDb movie · P4983 TMDb TV series · P345 IMDb · P212 ISBN-13 ·
//   P957 ISBN-10 · P436 MusicBrainz release group (album) · P4404 recording (track)
// A work's kind picks the property, so the same tmdb integer can't be misread as a
// TV id (separate TMDb namespaces), and an album mbid isn't queried as a recording.
const PROPERTY_ALLOWLIST = new Set(["P4947", "P4983", "P345", "P212", "P957", "P436", "P4404"]);

// Per-id-type value formats. Each admits only characters that cannot break out of a
// SPARQL string literal (the isSparqlLiteralSafe gate below is the hard guarantee).
const TMDB_VALUE = /^[0-9]+$/;
const IMDB_TITLE_VALUE = /^tt[0-9]{7,10}$/; // works are titles only; nm*/co* are people/companies
const MBID_VALUE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// ISBN as digits only (separators already stripped for length routing).
const ISBN13_DIGITS = /^97[89][0-9]{10}$/;
const ISBN10_DIGITS = /^[0-9]{9}[0-9Xx]$/;

// The final gate before a value touches the query string — the one check that
// actually guarantees no injection. Reject a double quote or backslash (which could
// terminate/escape the "..." literal) and any control/newline char. Hyphens and
// spaces (real in ISBNs) are safe and pass.
function isSparqlLiteralSafe(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes('"') || value.includes("\\")) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false; // control chars incl. newline/tab
  }
  return true;
}

function isbnDigits(value) {
  return String(value).replace(/[\s-]/g, "");
}

function workKeyOf(work) {
  if (work?.id != null) return String(work.id);
  if (work?.tmdb_id) return `tmdb:${work.tmdb_id}`;
  if (work?.imdb_id) return `imdb:${work.imdb_id}`;
  if (work?.isbn) return `isbn:${work.isbn}`;
  if (work?.mbid) return `mbid:${work.mbid}`;
  return null;
}

// Map one work row → the (property, value) lookups its ids justify. A work can yield
// several rows (a film with both a tmdb and an imdb id). Invalid / absent ids and
// unsupported kinds are silently dropped — a missing cross-walk is normal, not an error.
function candidatesForWork(work) {
  const workKey = workKeyOf(work);
  if (!workKey) return [];
  const rows = [];
  const push = (idType, property, value) => {
    if (isSparqlLiteralSafe(value)) rows.push({ workKey, idType, property, value });
  };

  switch (work.kind) {
    case "film":
    case "series": {
      const tmdbProp = work.kind === "film" ? "P4947" : "P4983";
      if (typeof work.tmdb_id === "string" && TMDB_VALUE.test(work.tmdb_id)) {
        push("tmdb", tmdbProp, work.tmdb_id);
      }
      if (typeof work.imdb_id === "string" && IMDB_TITLE_VALUE.test(work.imdb_id)) {
        push("imdb", "P345", work.imdb_id);
      }
      break;
    }
    case "book": {
      // Best-effort: Wikidata stores ISBN on EDITION items with canonical hyphenation
      // and coverage is sparse, so exact-string match resolves only a minority of
      // books. We route by length and send the id as provided (validated safe).
      if (typeof work.isbn === "string") {
        const digits = isbnDigits(work.isbn);
        if (ISBN13_DIGITS.test(digits)) push("isbn", "P212", work.isbn.trim());
        else if (ISBN10_DIGITS.test(digits)) push("isbn", "P957", work.isbn.trim());
      }
      break;
    }
    case "album":
    case "track": {
      const mbidProp = work.kind === "album" ? "P436" : "P4404";
      if (typeof work.mbid === "string" && MBID_VALUE.test(work.mbid)) {
        push("mbid", mbidProp, work.mbid);
      }
      break;
    }
    default:
      break;
  }
  return rows;
}

// Build the flat candidate list for a batch of works. Each candidate carries the
// originating workKey so parsed QIDs can be joined back to their work.
export function crosswalkCandidates(works) {
  return (Array.isArray(works) ? works : []).flatMap(candidatesForWork);
}

const MAX_CROSSWALK_ROWS = 400; // WDQS throttles heavy queries; batch, don't flood.

// Build the batched cross-walk SPARQL. VALUES (?prop ?val) pairs the allow-listed
// property with the validated value; `?item ?prop ?val` reverse-resolves each to its
// entity, and ?prop/?val are echoed so the caller can join QIDs back to inputs.
export function buildCrosswalkSparql(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (rows.length === 0) throw new Error("Cross-walk needs at least one candidate");
  if (rows.length > MAX_CROSSWALK_ROWS) {
    throw new Error(`Cross-walk batch exceeds ${MAX_CROSSWALK_ROWS} rows; split it`);
  }

  const values = rows
    .map(({ property, value }) => {
      if (!PROPERTY_ALLOWLIST.has(property)) {
        throw new Error(`Cross-walk property not allow-listed: ${property}`);
      }
      if (!isSparqlLiteralSafe(value)) {
        throw new Error("Cross-walk value is not a safe SPARQL literal");
      }
      return `    (wdt:${property} "${value}")`;
    })
    .join("\n");

  return `SELECT ?prop ?val ?item WHERE {
  VALUES (?prop ?val) {
${values}
  }
  ?item ?prop ?val .
}`;
}

// Parse the SPARQL JSON into { property, value, wikidataId } rows. ?prop comes back
// as the full wdt: predicate URI, so we recover the bare P-id; ?item as an entity
// URI reduced to its QID. Rows whose QID isn't canonical are dropped.
export function parseCrosswalkResults(payload) {
  const bindings = payload?.results?.bindings;
  if (!Array.isArray(bindings)) return [];

  const out = [];
  for (const row of bindings) {
    const property = row?.prop?.value?.match(/P\d+$/)?.[0] ?? null;
    const value = row?.val?.value ?? null;
    const qid = wikidataId(row?.item?.value);
    if (!property || value == null || !isWikidataId(qid)) continue;
    out.push({ property, value, wikidataId: qid });
  }
  return out;
}

// Numerically smallest QID — a deterministic representative so the result never
// depends on Wikidata's binding order.
function smallestQid(qids) {
  return [...qids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))[0];
}

// Join parsed QIDs back to their works. Returns Map(workKey → { wikidataId, conflict }).
// A single (property, value) can legitimately match several entities (an ISBN shared
// across edition items, duplicate entities), and a work's different ids can disagree —
// both are `conflict:true` so callers can log/skip. The chosen wikidataId is always the
// numerically smallest match, so the result is deterministic regardless of row order.
export function resolveWorkQids(candidates, parsed) {
  const qidsByPair = new Map();
  for (const hit of Array.isArray(parsed) ? parsed : []) {
    const key = `${hit.property} ${hit.value}`;
    let set = qidsByPair.get(key);
    if (!set) qidsByPair.set(key, (set = new Set()));
    set.add(hit.wikidataId);
  }

  // Per work: gather one representative QID per resolving id, and whether anything
  // was ambiguous (an id alone matching >1 entity, or ids disagreeing across the work).
  const perWork = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const set = qidsByPair.get(`${candidate.property} ${candidate.value}`);
    if (!set || set.size === 0) continue;
    let entry = perWork.get(candidate.workKey);
    if (!entry) perWork.set(candidate.workKey, (entry = { qids: new Set(), conflict: false }));
    if (set.size > 1) entry.conflict = true; // this id alone maps to multiple entities
    entry.qids.add(smallestQid(set));
  }

  const resolved = new Map();
  for (const [workKey, entry] of perWork) {
    resolved.set(workKey, {
      wikidataId: smallestQid(entry.qids),
      conflict: entry.conflict || entry.qids.size > 1,
    });
  }
  return resolved;
}

async function fetchSparql(query, { fetchImpl, endpoint, userAgent, signal, revalidate }) {
  const body = new URLSearchParams({ query, format: "json" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body,
      signal,
      next: { revalidate },
    });

    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status === 503;
    if (!retryable || attempt === 1) {
      throw new Error(`Wikidata cross-walk responded with ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Wikidata cross-walk exhausted retries");
}

// Resolve a batch of work rows to Wikidata QIDs in one request. Returns
// Map(workKey → { wikidataId, conflict }); works whose ids resolve to nothing are
// simply absent. fetchImpl is injected so tests never touch the network.
export async function crosswalkWikidataIds(works, {
  fetchImpl = (...args) => fetch(...args),
  endpoint = WIKIDATA_ENDPOINT,
  userAgent = USER_AGENT,
  signal,
  revalidate = 86400,
} = {}) {
  const candidates = crosswalkCandidates(works);
  if (candidates.length === 0) return new Map();

  const payload = await fetchSparql(buildCrosswalkSparql(candidates), {
    fetchImpl,
    endpoint,
    userAgent,
    signal,
    revalidate,
  });

  return resolveWorkQids(candidates, parseCrosswalkResults(payload));
}
