import { z } from "zod";

export const MAX_TMDB_CANDIDATES = 24;
const MAX_SCENE_FRAMES = 3;
const SCENE_IMAGE_MATCH_VERSION = "4";

const sceneImageRequestSchema = z.object({
  tmdbId: z.string().regex(/^[1-9]\d*$/),
  workId: z.string().regex(/^Q[1-9]\d*$/),
  locationId: z.string().regex(/^Q[1-9]\d*$/),
});

const sceneFrameMatchSchema = z.object({
  candidateIndex: z.number().int().min(-1).max(MAX_TMDB_CANDIDATES - 1),
  confidence: z.enum(["high", "medium", "low", "none"]),
  isPhotographicFrame: z.boolean(),
  hasProminentTitleOrLogo: z.boolean(),
  locationType: z.enum([
    "street",
    "bar_or_restaurant",
    "building",
    "studio",
    "landscape",
    "other",
  ]),
  description: z.string().trim().min(1).max(240),
});

export const sceneImageMatchSchema = z.object({
  matches: z.array(sceneFrameMatchSchema).max(MAX_SCENE_FRAMES),
});

export function isStudioLocation(place) {
  return typeof place === "string"
    && /\b(studio|studios|sound[ -]?stage)\b/i.test(place);
}

export function isAllowedLocationImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && [
      "commons.wikimedia.org",
      "upload.wikimedia.org",
      "images.unsplash.com",
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

export function parseSceneImageRequest(searchParams) {
  const parsed = sceneImageRequestSchema.safeParse({
    tmdbId: searchParams.get("tmdbId"),
    workId: searchParams.get("workId"),
    locationId: searchParams.get("locationId"),
  });

  return parsed.success ? parsed.data : null;
}

export function canonicalSceneImageQuery({ tmdbId, workId, locationId }, token = null) {
  const params = new URLSearchParams({ tmdbId, workId, locationId });
  if (token) params.set("token", token);
  params.set("v", SCENE_IMAGE_MATCH_VERSION);
  return params.toString();
}

export function buildWikidataSceneQuery({ workId, locationId }) {
  if (!/^Q[1-9]\d*$/.test(workId) || !/^Q[1-9]\d*$/.test(locationId)) {
    throw new Error("Wikidata ids must be canonical Q ids");
  }

  return `
SELECT ?workLabel ?locationLabel ?tmdbId ?image WHERE {
  VALUES ?work { wd:${workId} }
  VALUES ?location { wd:${locationId} }
  ?work wdt:P915 ?location ;
        wdt:P4947 ?tmdbId .
  OPTIONAL { ?location wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 1`;
}

export function parseWikidataSceneContext(payload, expected) {
  const rows = payload?.results?.bindings;
  if (!Array.isArray(rows)) return null;

  const row = rows.find((candidate) => candidate.tmdbId?.value === expected.tmdbId);
  if (!row) return null;

  const rawImageUrl = row.image?.value?.replace(/^http:\/\//, "https://") ?? null;
  return {
    filmTitle: row.workLabel?.value ?? expected.workId,
    place: row.locationLabel?.value ?? expected.locationId,
    locationImageUrl: isAllowedLocationImageUrl(rawImageUrl) ? rawImageUrl : null,
  };
}

export function sceneMatchClientId(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function createSceneMatchRateLimiter({ limit = 12, windowMs = 10 * 60_000 } = {}) {
  const buckets = new Map();

  return function allowRequest(clientId, now = Date.now()) {
    const current = buckets.get(clientId);
    if (!current && buckets.size >= 5_000) {
      for (const [key, bucket] of buckets) {
        if (now - bucket.startedAt >= windowMs) buckets.delete(key);
      }
      if (buckets.size >= 5_000) return false;
    }

    if (!current || now - current.startedAt >= windowMs) {
      buckets.set(clientId, { count: 1, startedAt: now });
      return true;
    }

    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
}

export function buildSceneImageContent({
  filmTitle,
  place,
  locationImageUrl,
  candidateImageUrls,
}) {
  const studioLocation = isStudioLocation(place);
  const context = JSON.stringify({ filmTitle, place, studioLocation });
  const content = [
    {
      type: "input_text",
      text: [
        `Context data: ${context}`,
        locationImageUrl
          ? "The reference image is a present-day contextual photo of the named place and may show a different side from the filmed scene."
          : "No present-day reference image is available.",
        "The numbered images are candidate backdrops from the film.",
        "First inspect the candidate itself. A title card, poster, logo, illustration, graphic, or text-dominant image is not a photographic film frame and must never be returned as a match.",
        studioLocation
          ? "The canonical location is explicitly a studio. Select up to three representative frames, classify them as studio, describe only what is visible, and say that the exact soundstage is not visually verifiable."
          : "The canonical film-location relationship is already verified. Select up to three distinct candidates that visibly fit the named location, including a changed-era or interior-to-exterior match only when concrete details support it.",
        studioLocation
          ? "Do not claim a specific room, set, or soundstage."
          : "Require visible support such as architecture, layout, landscape, or signage. Names alone are not enough.",
        "Return high confidence only for frames suitable to show as location matches. Return an empty matches array when none qualify.",
        "For every returned frame, set isPhotographicFrame true only for a real photographic scene, set hasProminentTitleOrLogo accurately, write one short factual description of visible evidence, and classify the verified place type.",
        "Never describe architecture, scenery, or objects that are not visibly present in that exact candidate image.",
      ].join(" "),
    },
  ];

  if (locationImageUrl) {
    content.push(
      { type: "input_text", text: "REFERENCE LOCATION IMAGE" },
      { type: "input_image", image_url: locationImageUrl, detail: "low" },
    );
  }

  candidateImageUrls.forEach((imageUrl, index) => {
    content.push(
      { type: "input_text", text: `CANDIDATE ${index}` },
      { type: "input_image", image_url: imageUrl, detail: "low" },
    );
  });

  return content;
}

export function acceptedSceneImageMatch(match, candidateCount) {
  if (!match || match.confidence !== "high") return null;
  if (match.isPhotographicFrame !== true || match.hasProminentTitleOrLogo !== false) return null;
  if (!Number.isInteger(match.candidateIndex)) return null;
  if (match.candidateIndex < 0 || match.candidateIndex >= candidateCount) return null;
  return match.candidateIndex;
}

export function acceptedSceneImageMatches(result, candidateCount) {
  if (!Array.isArray(result?.matches)) return [];

  const seen = new Set();
  return result.matches.filter((match) => {
    const candidateIndex = acceptedSceneImageMatch(match, candidateCount);
    if (candidateIndex === null || seen.has(candidateIndex)) return false;
    seen.add(candidateIndex);
    return true;
  }).slice(0, MAX_SCENE_FRAMES);
}
