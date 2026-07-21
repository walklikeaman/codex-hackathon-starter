export const RADIUS_OPTIONS_METERS = [100, 300, 1000, 3000];

// Deterministic fallback for demos and denied-permission flows: Trafalgar
// Square sits inside the seeded London dataset, so the nearest-point card is
// always populated.
export const DEMO_LOCATION = {
  label: "Trafalgar Square (demo)",
  position: [51.508, -0.1281],
};

function assertPosition(value, name) {
  const isValid =
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -90 &&
    value[0] <= 90 &&
    value[1] >= -180 &&
    value[1] <= 180;

  if (!isValid) {
    throw new Error(`${name} must be a [latitude, longitude] pair`);
  }
}

export function distanceMeters(from, to) {
  assertPosition(from, "from");
  assertPosition(to, "to");

  const toRad = (value) => (value * Math.PI) / 180;
  const earthMeters = 6371000;
  const dLat = toRad(to[0] - from[0]);
  const dLon = toRad(to[1] - from[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from[0])) * Math.cos(toRad(to[0])) * Math.sin(dLon / 2) ** 2;

  return earthMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearby(userPosition, locations, radiusMeters) {
  assertPosition(userPosition, "userPosition");

  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error("radiusMeters must be a positive number");
  }

  const measured = (Array.isArray(locations) ? locations : [])
    .filter((location) => Array.isArray(location?.position))
    .map((location) => ({
      location,
      distanceMeters: distanceMeters(userPosition, location.position),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return {
    nearest: measured[0] ?? null,
    inRadius: measured.filter((entry) => entry.distanceMeters <= radiusMeters),
  };
}

export function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters) || meters < 0) {
    throw new Error("meters must be a non-negative number");
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

export function mapSearchRadiusKm(distanceToCornerMeters) {
  if (!Number.isFinite(distanceToCornerMeters) || distanceToCornerMeters <= 0) {
    throw new Error("distanceToCornerMeters must be a positive number");
  }

  const radiusKm = Math.ceil(distanceToCornerMeters / 100) / 10;
  return Math.min(50, Math.max(0.5, radiusKm));
}

export function zoomForRadius(radiusMeters) {
  if (radiusMeters <= 100) return 17;
  if (radiusMeters <= 300) return 16;
  if (radiusMeters <= 1000) return 14;

  return 13;
}
