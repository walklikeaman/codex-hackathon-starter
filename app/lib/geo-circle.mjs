// A circle on the ground, as a polygon.
//
// Leaflet had `<Circle radius={metres}>`; MapLibre does not. Its `circle-radius` is measured
// in SCREEN PIXELS, which is the wrong thing entirely for what this draws: the dashed ring
// that says "the source named a city, not a doorway". A pixel radius would keep that ring
// the same size on screen while the city under it grew and shrank — the ring would stop
// meaning a distance at all.
//
// So the ring is a polygon in real coordinates, and the map is free to project it.

const EARTH_RADIUS_M = 6378137;
const DEGREES_PER_RADIAN = 180 / Math.PI;

// 64 points puts the worst error under a tenth of a percent of the radius — well inside the
// honesty of the number itself, which is an order of magnitude ("a village you could cross
// on foot, a county you could not"), not a survey.
export const DEFAULT_STEPS = 64;

export function circlePolygon(center, radiusMeters, steps = DEFAULT_STEPS) {
  const [lng, lat] = Array.isArray(center) ? center : [center?.lng, center?.lat];

  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !(radiusMeters > 0)) return null;

  // Metres to degrees. Longitude converges towards the poles, so it is divided by the cosine
  // of the latitude — without that, a ring over Reykjavík is drawn as an ellipse.
  const latitudeSpan = (radiusMeters / EARTH_RADIUS_M) * DEGREES_PER_RADIAN;
  const cosine = Math.cos((lat * Math.PI) / 180);
  // At the pole the cosine is zero and the longitude span is infinite. Nothing this app maps
  // is there, but a NaN ring would be drawn as nothing with no explanation.
  const longitudeSpan = Math.abs(cosine) < 1e-9 ? 180 : latitudeSpan / cosine;

  const ring = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * 2 * Math.PI;
    ring.push([
      lng + longitudeSpan * Math.cos(angle),
      lat + latitudeSpan * Math.sin(angle),
    ]);
  }
  // GeoJSON wants the ring closed: the last position repeats the first.
  ring.push(ring[0]);

  return { type: "Polygon", coordinates: [ring] };
}

export function circleFeature(center, radiusMeters, properties = {}, steps = DEFAULT_STEPS) {
  const geometry = circlePolygon(center, radiusMeters, steps);
  if (!geometry) return null;
  return { type: "Feature", geometry, properties };
}
