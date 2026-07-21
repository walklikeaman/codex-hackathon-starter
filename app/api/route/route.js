const WALKING_ROUTER_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const MAX_STOPS = 5;

export const runtime = "nodejs";

function isCoordinate(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -90 &&
    value[0] <= 90 &&
    value[1] >= -180 &&
    value[1] <= 180
  );
}

export async function POST(request) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const coordinates = payload?.coordinates;

  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.length > MAX_STOPS ||
    !coordinates.every(isCoordinate)
  ) {
    return Response.json(
      { error: `Provide between 2 and ${MAX_STOPS} valid coordinates.` },
      { status: 400 },
    );
  }

  const path = coordinates.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `${WALKING_ROUTER_URL}/${path}?overview=full&geometries=geojson&steps=false`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "SceneMap-MVP/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`OSRM responded with ${response.status}`);
    }

    const data = await response.json();
    const result = data.routes?.[0];

    if (data.code !== "Ok" || !result?.geometry?.coordinates?.length) {
      throw new Error("OSRM returned no route");
    }

    return Response.json({
      positions: result.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceMeters: result.distance,
      durationSeconds: result.duration,
    });
  } catch {
    return Response.json(
      { error: "The walking route service is temporarily unavailable." },
      { status: 502 },
    );
  }
}
