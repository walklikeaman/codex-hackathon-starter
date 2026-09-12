// Asking Wikidata's public endpoint a question it will actually answer.
//
// Two lessons are baked in here, both paid for:
//
// **Ask about what you hold, never page the whole property.** A `LIMIT/OFFSET` walk over
// 206,443 statements answered **502 on the second page** — an OFFSET re-sorts the lot on
// every request, and page two is where that bill lands. Chunked `VALUES` of the ids we
// actually care about is cheap enough to answer first time, every time.
//
// **A failed chunk is lost data, not a lost request.** The first discovery run dropped 2 of
// 16 chunks to 502 and reported the short number as the answer — 12% missing, silently.
// Retrying bought it back; the run that did found a quarter more.
//
// Related: [[fandom-discovery]].

export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

// Measured, not chosen: 400 ids per query answers in one go, where the unbounded scan did
// not answer at all.
export const IDS_PER_QUERY = 400;

// The endpoint asks for a gap between queries and it is not negotiable — the whole reason
// these passes are affordable is that they are small, and a small pass that hammers a free
// service is not cheap, it is rude.
export const QUERY_GAP_MS = 5000;
const ATTEMPTS = 3;

export function chunk(items, size = IDS_PER_QUERY) {
  const out = [];
  for (let index = 0; index < (items?.length ?? 0); index += size) out.push(items.slice(index, index + size));
  return out;
}

export function valuesClause(ids, pattern = /^tt\d+$/) {
  return (ids ?? [])
    .filter((id) => pattern.test(String(id ?? "")))
    .map((id) => `"${id}"`)
    .join(" ");
}

export function createSparqlClient({
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  userAgent = "GloryMap/1.0 (filming locations; nakonechnyi.n@gmail.com)",
  attempts = ATTEMPTS,
  gapMs = QUERY_GAP_MS,
} = {}) {
  return async function query(sparql) {
    let last;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // **A flag, not a `throw`.** The first version threw on a 4xx to skip the retries,
      // and its own `catch` two lines below caught that throw and retried anyway — the
      // early exit was swallowed by the handler it was trying to escape. A test asserting
      // "a 4xx must not be retried" is what found it; nothing about the behaviour looked
      // wrong from outside, it was merely three times slower to report a broken query.
      let retryable = true;
      try {
        const url = `${WIKIDATA_SPARQL}?${new URLSearchParams({ query: sparql, format: "json" })}`;
        const response = await fetchImpl(url, {
          headers: { "User-Agent": userAgent, Accept: "application/sparql-results+json" },
          signal: AbortSignal.timeout(120_000),
        });
        if (response.ok) return (await response.json()).results.bindings;
        last = new Error(`wikidata http ${response.status}`);
        // 4xx is the query's own fault and will fail identically next time. Only a
        // server-side refusal or a rate limit is worth waiting out.
        retryable = response.status >= 500 || response.status === 429;
      } catch (failure) {
        last = failure?.name === "AbortError" ? new Error("wikidata timeout") : failure;
      }
      if (!retryable) break;
      if (attempt < attempts) await sleep(gapMs * attempt);
    }
    throw last ?? new Error("wikidata failed");
  };
}

// One Wikidata item per external id, or none.
//
// **An id matching several items is refused rather than resolved.** Measured over 400 of
// our IMDb ids: 393 matched, and 2 of those matched two items each — a work and its
// adaptation, a film and its series. Taking the first would write a plausible id that is
// simply about a different thing, and nothing downstream could ever tell.
export function singleMatches(bindings, { key = "imdb", value = "item" } = {}) {
  const seen = new Map();
  for (const row of bindings ?? []) {
    const id = row?.[key]?.value;
    const uri = row?.[value]?.value;
    if (!id || !uri) continue;
    const qid = String(uri).split("/").pop();
    if (!/^Q[1-9]\d*$/.test(qid)) continue;
    if (!seen.has(id)) seen.set(id, new Set());
    seen.get(id).add(qid);
  }
  const single = new Map();
  const ambiguous = [];
  for (const [id, qids] of seen) {
    if (qids.size === 1) single.set(id, [...qids][0]);
    else ambiguous.push({ id, qids: [...qids] });
  }
  return { single, ambiguous };
}
