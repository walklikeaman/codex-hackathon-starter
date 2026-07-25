// Image attribution — one normalised shape for every image source we display.
//
// Each provider has its own terms, and getting them wrong is a legal problem rather
// than a cosmetic one: TMDB requires an explicit "not endorsed by TMDB" credit,
// Wikimedia files are licensed per FILE (not per site) and require author + licence,
// Mapillary is CC BY-SA, Unsplash asks for photographer credit.
//
// The rule this module enforces: **an image whose attribution we cannot state is not
// shown.** That is the same principle as the map itself — we do not display something
// we cannot source. `isDisplayable()` is the gate; callers must respect it.

const SOURCES = Object.freeze({
  tmdb: {
    label: "TMDB",
    // TMDB's terms require this wording wherever their data or images appear.
    notice: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    homepage: "https://www.themoviedb.org/",
    // TMDB artwork is licensed to TMDB by the studios; there is no per-file licence
    // to name, so the credit is the source itself.
    licenseRequired: false,
  },
  wikimedia: {
    label: "Wikimedia Commons",
    homepage: "https://commons.wikimedia.org/",
    // Per-file: a Commons image without its author and licence cannot be shown.
    licenseRequired: true,
  },
  mapillary: {
    label: "Mapillary",
    homepage: "https://www.mapillary.com/",
    licenseRequired: true,
  },
  unsplash: {
    label: "Unsplash",
    homepage: "https://unsplash.com/",
    licenseRequired: false,
  },
  user: {
    label: "Your photo",
    homepage: null,
    licenseRequired: false, // the person who took it is looking at it
  },
});

// Well-known licence links, so a credit can always be verified by the reader.
const LICENSE_URLS = Object.freeze({
  "cc-by-sa-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "cc-by-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "cc-by-sa-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "public-domain": "https://en.wikipedia.org/wiki/Public_domain",
});

export function isKnownSource(source) {
  return Object.prototype.hasOwnProperty.call(SOURCES, source);
}

export function sourceInfo(source) {
  return SOURCES[source] ?? null;
}

export function licenseUrl(license) {
  if (typeof license !== "string") return null;
  return LICENSE_URLS[license.toLowerCase().replace(/\s+/g, "-")] ?? null;
}

// Infer the source from an image URL. Used for images that reach the UI without an
// explicit attribution — it recovers the source where the host makes it unambiguous,
// and returns null otherwise so the fail-safe applies rather than a guess.
export function sourceFromUrl(url) {
  if (typeof url !== "string") return null;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host === "image.tmdb.org" || host.endsWith(".themoviedb.org")) return "tmdb";
  if (host.endsWith("wikimedia.org") || host === "commons.wikimedia.org") return "wikimedia";
  if (host.endsWith("mapillary.com")) return "mapillary";
  if (host === "images.unsplash.com" || host.endsWith("unsplash.com")) return "unsplash";
  return null;
}

// Normalise whatever a caller has into the one shape the UI renders.
export function normalizeAttribution(input, { url } = {}) {
  const source = input?.source ?? sourceFromUrl(input?.url ?? url);
  if (!isKnownSource(source)) return null;

  const info = SOURCES[source];
  const license = typeof input?.license === "string" && input.license.trim()
    ? input.license.trim()
    : null;

  return {
    source,
    label: info.label,
    author: typeof input?.author === "string" && input.author.trim() ? input.author.trim() : null,
    license,
    license_url: licenseUrl(license) ?? (typeof input?.license_url === "string" ? input.license_url : null),
    source_url: typeof input?.source_url === "string" ? input.source_url : info.homepage,
    notice: info.notice ?? null,
  };
}

// The fail-safe: may this image be displayed at all?
// A source we do not recognise, or a per-file licensed source (Commons, Mapillary)
// missing its author or licence, is NOT displayable — we would be republishing
// someone's work without the credit their licence requires.
export function isDisplayable(attribution) {
  if (!attribution || !isKnownSource(attribution.source)) return false;
  if (!SOURCES[attribution.source].licenseRequired) return true;
  return Boolean(attribution.author && attribution.license);
}

// A single line of credit, e.g. "Wikimedia Commons · Jane Doe · CC BY-SA 4.0".
export function creditLine(attribution) {
  if (!attribution) return "";
  return [attribution.label, attribution.author, attribution.license]
    .filter(Boolean)
    .join(" · ");
}

// Every distinct notice that must appear somewhere on a page showing these images
// (TMDB's wording, for instance). Deduplicated, because one credit per page is enough.
export function requiredNotices(attributions) {
  const notices = new Set();
  for (const attribution of Array.isArray(attributions) ? attributions : []) {
    if (attribution?.notice) notices.add(attribution.notice);
  }
  return [...notices];
}
