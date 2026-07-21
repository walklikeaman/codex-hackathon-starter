export const DEFAULT_FOOT_ROUTER_URL =
  "https://routing.openstreetmap.de/routed-foot/route/v1/driving";

export function validateRouteStops(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5) {
    throw new Error("Route requires between 2 and 5 stops");
  }

  return value.map((stop) => {
    if (!Array.isArray(stop) || stop.length !== 2) {
      throw new Error("Each route stop must be a [latitude, longitude] pair");
    }

    const [latitude, longitude] = stop;
    const isValid =
      typeof latitude === "number" &&
      typeof longitude === "number" &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;

    if (!isValid) {
      throw new Error("Route stop coordinates are invalid");
    }

    return [latitude, longitude];
  });
}

export function buildFootRouteUrl(stops, routerUrl = DEFAULT_FOOT_ROUTER_URL) {
  const coordinates = validateRouteStops(stops)
    .map(([latitude, longitude]) => `${longitude},${latitude}`)
    .join(";");
  const url = new URL(`${routerUrl.replace(/\/$/, "")}/${coordinates}`);

  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");

  return url;
}

export function parseFootRoute(payload) {
  const route = payload?.code === "Ok" ? payload.routes?.[0] : null;
  const coordinates = route?.geometry?.coordinates;
  const hasMetrics =
    Number.isFinite(route?.distance) &&
    Number.isFinite(route?.duration) &&
    route.distance >= 0 &&
    route.duration >= 0;

  if (
    route?.geometry?.type !== "LineString" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !hasMetrics
  ) {
    throw new Error("Walking router returned an invalid route");
  }

  const positions = coordinates.map((coordinate) => {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1]) ||
      coordinate[0] < -180 ||
      coordinate[0] > 180 ||
      coordinate[1] < -90 ||
      coordinate[1] > 90
    ) {
      throw new Error("Walking router returned invalid geometry");
    }

    return [coordinate[1], coordinate[0]];
  });

  return {
    positions,
    distanceKm: Math.round(route.distance / 100) / 10,
    durationMinutes: Math.max(1, Math.round(route.duration / 60)),
  };
}
