import { assertPosition, haversineMeters } from "./geo.mjs";

export const RADIUS_OPTIONS_METERS = [100, 300, 1000, 3000];

// Deterministic fallback for demos and denied-permission flows: Trafalgar
// Square sits inside the seeded London dataset, so the nearest-point card is
// always populated.
export const DEMO_LOCATION = {
  label: "Trafalgar Square (demo)",
  position: [51.508, -0.1281],
};

export function distanceMeters(from, to) {
  assertPosition(from, "from");
  assertPosition(to, "to");
  return haversineMeters(from, to);
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
