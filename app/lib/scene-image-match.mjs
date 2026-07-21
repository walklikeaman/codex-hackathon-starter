import { z } from "zod";

export const MAX_TMDB_CANDIDATES = 6;

const sceneImageRequestSchema = z.object({
  tmdbId: z.string().regex(/^[1-9]\d*$/),
  workId: z.string().regex(/^Q[1-9]\d*$/),
  locationId: z.string().regex(/^Q[1-9]\d*$/),
});

export const sceneImageMatchSchema = z.object({
  candidateIndex: z.number().int().min(-1).max(MAX_TMDB_CANDIDATES - 1),
  confidence: z.enum(["high", "medium", "low", "none"]),
  evidence: z.string().trim().max(240),
});

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
  const context = JSON.stringify({ filmTitle, place });
  const content = [
    {
      type: "input_text",
      text: [
        `Context data: ${context}`,
        "The first image is a present-day reference photo of the named place.",
        "The remaining numbered images are candidate backdrops from the film.",
        "Return a candidate only when distinctive visible architecture, layout, or signage proves that it shows the same physical place.",
        "Film or place names alone are not evidence. If the match is uncertain or the place is not visible, return candidateIndex -1 and confidence none.",
      ].join(" "),
    },
    { type: "input_text", text: "REFERENCE LOCATION IMAGE" },
    { type: "input_image", image_url: locationImageUrl, detail: "low" },
  ];

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
  if (!Number.isInteger(match.candidateIndex)) return null;
  if (match.candidateIndex < 0 || match.candidateIndex >= candidateCount) return null;
  return match.candidateIndex;
}
