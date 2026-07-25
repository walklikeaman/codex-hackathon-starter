// Mapillary — street-level photos under CC BY-SA 4.0, the first choice for
// "the place today" because we may legally store it AND it reports the direction the
// camera was facing (compass_angle), which is what lets us match a film frame's angle.
//
// Preview URLs carry a TTL. We therefore keep the IMAGE ID, never the URL: a stored
// thumb_*_url stops resolving after a while, and a broken photo is worse than none.

const GRAPH_API = "https://graph.mapillary.com/images";

// Metres → degrees, near enough for a bbox a few hundred metres across. Longitude
// degrees shrink with latitude, hence the cosine.
export function bboxAround(lat, lng, radiusM) {
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return {
    west: lng - lngDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    north: lat + latDelta,
  };
}

export function buildMapillaryUrl({ lat, lng, radius = 120, limit = 12, token }) {
  if (!token) throw new Error("Mapillary token is required");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Mapillary search requires a valid coordinate");
  }
  const box = bboxAround(lat, lng, Math.max(10, Math.min(radius, 1000)));
  const url = new URL(GRAPH_API);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,compass_angle,computed_geometry,captured_at,thumb_1024_url");
  url.searchParams.set("bbox", `${box.west},${box.south},${box.east},${box.north}`);
  url.searchParams.set("limit", String(Math.max(1, Math.min(Math.round(limit), 50))));
  return url;
}

// Rough metres between two coordinates — enough to rank candidates inside one bbox.
function distanceMeters(a, b) {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
}

export function parseMapillaryImages(payload, { lat, lng } = {}) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const origin = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  const candidates = [];
  for (const item of items) {
    const coords = item?.computed_geometry?.coordinates;
    const url = item?.thumb_1024_url;
    if (!item?.id || typeof url !== "string" || !Array.isArray(coords)) continue;
    const [imageLng, imageLat] = coords;
    if (!Number.isFinite(imageLat) || !Number.isFinite(imageLng)) continue;

    candidates.push({
      image_id: String(item.id),   // the durable handle; the URL below expires
      image_url: url,
      compass_angle: Number.isFinite(item.compass_angle) ? item.compass_angle : null,
      distance_m: origin ? distanceMeters(origin, { lat: imageLat, lng: imageLng }) : null,
      captured_at: item.captured_at ?? null,
      attribution: {
        source: "mapillary",
        // Mapillary imagery is CC BY-SA 4.0; the platform is the credited party
        // unless a contributor name is exposed, which the images endpoint does not do.
        author: "Mapillary contributors",
        license: "CC BY-SA 4.0",
        license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
        source_url: `https://www.mapillary.com/app/?focus=photo&pKey=${encodeURIComponent(item.id)}`,
      },
    });
  }
  return candidates;
}

export async function fetchMapillaryNearby({ lat, lng, radius, limit }, {
  fetchImpl = (...args) => fetch(...args),
  token,
  signal,
  revalidate = 3600,
} = {}) {
  if (!token) return []; // not configured — the cascade simply moves on
  const response = await fetchImpl(buildMapillaryUrl({ lat, lng, radius, limit, token }), {
    headers: { Accept: "application/json" },
    signal,
    next: { revalidate },
  });
  if (!response.ok) throw new Error(`Mapillary responded with ${response.status}`);
  return parseMapillaryImages(await response.json(), { lat, lng });
}
