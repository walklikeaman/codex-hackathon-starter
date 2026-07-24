// Ratings for works — pure normalisation of what OMDb and TMDB report.
//
// Two rules shape this module:
//
// 1. **Never restate a score in a scale its source did not use.** IMDb says "7.8/10",
//    Rotten Tomatoes says "92%". Both normalise to 0..100 for sorting, but `display`
//    always keeps the source's own wording, so nobody reads "78%" and thinks IMDb
//    said that.
// 2. **A rating without a link is a number we're asking people to trust.** Every row
//    carries the URL of the page it came from, the same principle as place evidence.

const OMDB_SOURCES = Object.freeze({
  "internet movie database": "imdb",
  "rotten tomatoes": "rotten_tomatoes",
  metacritic: "metacritic",
});

export const RATING_LABELS = Object.freeze({
  imdb: "IMDb",
  rotten_tomatoes: "Rotten Tomatoes",
  metacritic: "Metacritic",
  tmdb: "TMDB",
});

const IMDB_ID = /^tt\d{7,10}$/;
// Wikidata P1258 is a path like "m/skyfall" or "tv/the_crown" — never a full URL.
const RT_PATH = /^(?:m|tv)\/[A-Za-z0-9_-]+$/;
// Wikidata P1712, e.g. "movie/skyfall" or "tv/the-crown".
const MC_PATH = /^(?:movie|tv)\/[A-Za-z0-9_-]+$/;

export function isImdbId(value) {
  return typeof value === "string" && IMDB_ID.test(value);
}

export function imdbUrl(imdbId) {
  return isImdbId(imdbId) ? `https://www.imdb.com/title/${imdbId}/` : null;
}

export function rottenTomatoesUrl(rtPath) {
  return typeof rtPath === "string" && RT_PATH.test(rtPath)
    ? `https://www.rottentomatoes.com/${rtPath}`
    : null;
}

export function metacriticUrl(mcPath) {
  return typeof mcPath === "string" && MC_PATH.test(mcPath)
    ? `https://www.metacritic.com/${mcPath}`
    : null;
}

// "7.8/10" → 78, "92%" → 92, "81/100" → 81. Returns null for anything unparseable
// rather than a zero, because a missing rating and a rating of zero are not the same
// claim and must not look alike.
export function normalizeScore(value) {
  if (typeof value !== "string") return null;
  const percent = value.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percent) return clampScore(Number(percent[1]));

  const fraction = value.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const [, score, outOf] = fraction;
    const max = Number(outOf);
    if (!Number.isFinite(max) || max <= 0) return null;
    return clampScore((Number(score) / max) * 100);
  }
  return null;
}

function clampScore(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100) / 100;
}

function parseVotes(value) {
  if (typeof value !== "string") return null;
  const digits = Number(value.replace(/[,\s]/g, ""));
  return Number.isInteger(digits) && digits >= 0 ? digits : null;
}

// Turn one OMDb payload into rating rows. `links` supplies the source URLs, which OMDb
// itself does not return for Rotten Tomatoes or Metacritic.
export function ratingsFromOmdb(payload, { imdbId, rtPath, mcPath } = {}) {
  if (payload?.Response !== "True") return [];

  const rows = [];
  const seen = new Set();
  for (const entry of Array.isArray(payload.Ratings) ? payload.Ratings : []) {
    const source = OMDB_SOURCES[String(entry?.Source ?? "").toLowerCase()];
    const display = typeof entry?.Value === "string" ? entry.Value.trim() : "";
    if (!source || !display || seen.has(source)) continue;

    const score = normalizeScore(display);
    if (score === null) continue; // an unparseable score is dropped, never guessed
    seen.add(source);

    rows.push({
      source,
      score,
      display,
      votes: source === "imdb" ? parseVotes(payload.imdbVotes) : null,
      source_url: source === "imdb"
        ? imdbUrl(imdbId ?? payload.imdbID)
        : source === "rotten_tomatoes"
          ? rottenTomatoesUrl(rtPath)
          : source === "metacritic"
            ? metacriticUrl(mcPath)
            : null,
    });
  }
  return rows;
}

// TMDB always has a score, so it is the fallback that keeps a card from looking empty.
export function ratingFromTmdb(payload, tmdbId, kind = "film") {
  const average = Number(payload?.vote_average);
  if (!Number.isFinite(average) || average <= 0) return null;
  const segment = kind === "series" ? "tv" : "movie";
  return {
    source: "tmdb",
    score: clampScore(average * 10),
    display: `${Math.round(average * 10) / 10}/10`,
    votes: Number.isInteger(payload?.vote_count) ? payload.vote_count : null,
    source_url: /^[1-9]\d*$/.test(String(tmdbId ?? ""))
      ? `https://www.themoviedb.org/${segment}/${tmdbId}`
      : null,
  };
}

// Presentation order: the two the owner asked for first, then the rest.
const DISPLAY_ORDER = ["imdb", "rotten_tomatoes", "metacritic", "tmdb"];

export function sortRatings(ratings) {
  return [...(Array.isArray(ratings) ? ratings : [])].sort(
    (a, b) => DISPLAY_ORDER.indexOf(a.source) - DISPLAY_ORDER.indexOf(b.source),
  );
}

export function ratingRows(workId, ratings) {
  return sortRatings(ratings)
    .filter((rating) => rating && rating.display)
    .map((rating) => ({
      work_id: workId,
      source: rating.source,
      score: rating.score ?? null,
      display: rating.display,
      votes: rating.votes ?? null,
      source_url: rating.source_url ?? null,
    }));
}
