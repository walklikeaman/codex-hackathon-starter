import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SCENE_MATCH_TOKEN_CACHE_CONTROL = "private, no-store";

function sceneMatchPayload({ tmdbId, workId, locationId }) {
  if (!/^[1-9]\d*$/.test(String(tmdbId))) return null;
  if (!/^Q[1-9]\d*$/.test(String(workId))) return null;
  if (!/^Q[1-9]\d*$/.test(String(locationId))) return null;
  return `v1:${tmdbId}:${workId}:${locationId}`;
}

// One explicit secret, with no fallback to an API key.
//
// It used to fall back to OPENAI_API_KEY, which quietly coupled two unrelated things:
// rotating or removing that key — exactly what switching model providers involves —
// changed the signing secret, invalidating every token already stamped onto a
// location. The user's symptom is a 403 on a page they already have open, with nothing
// in the deploy that looks related.
export function sceneMatchSigningSecret(env = process.env) {
  const secret = env.SCENE_MATCH_SIGNING_SECRET;
  return typeof secret === "string" && secret.trim() ? secret : null;
}

export function signSceneMatchRequest(request, secret) {
  const payload = sceneMatchPayload(request);
  if (!payload || !secret) return null;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifySceneMatchToken(request, token, secret) {
  if (!TOKEN_PATTERN.test(token ?? "")) return false;
  const expected = signSceneMatchRequest(request, secret);
  if (!expected) return false;

  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function addSceneMatchTokens(locations, env = process.env) {
  const secret = sceneMatchSigningSecret(env);
  if (!secret) return locations;

  return locations.map((location) => {
    if (location.kind !== "film") return location;
    const token = signSceneMatchRequest({
      tmdbId: location.film_tmdb_id,
      workId: location.work_wikidata_id,
      locationId: location.loc_wikidata_id,
    }, secret);

    return token ? { ...location, scene_match_token: token } : location;
  });
}
