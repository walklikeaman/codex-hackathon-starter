// Shared geo helpers — one haversine, one Earth radius, one coordinate validator,
// so the copies that had drifted across nearby/timed-tour/location-search and the
// map component can't diverge again (audit finding #80). Pure module.

export const EARTH_RADIUS_M = 6371000;
export const EARTH_RADIUS_KM = 6371;
export const WALKING_SPEED_KMH = 4.6;

const toRadians = (value) => (value * Math.PI) / 180;

// A [lat, lng] pair of finite numbers (no range check).
export function isFinitePair(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

// A [lat, lng] pair that is also within valid Earth ranges.
export function isLatLng(value) {
  return (
    isFinitePair(value) &&
    value[0] >= -90 && value[0] <= 90 &&
    value[1] >= -180 && value[1] <= 180
  );
}

export function assertPosition(value, name = "position") {
  if (!isLatLng(value)) {
    throw new Error(`${name} must be a [latitude, longitude] pair`);
  }
}

// Great-circle distance between two [lat, lng] points, in `radius` units.
function haversine(from, to, radius) {
  const dLat = toRadians(to[0] - from[0]);
  const dLon = toRadians(to[1] - from[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from[0])) * Math.cos(toRadians(to[0])) * Math.sin(dLon / 2) ** 2;

  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineMeters(from, to) {
  return haversine(from, to, EARTH_RADIUS_M);
}

export function haversineKm(from, to) {
  return haversine(from, to, EARTH_RADIUS_KM);
}
