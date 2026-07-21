import {
  buildFootRouteUrl,
  parseFootRoute,
  validateRouteStops,
} from "../../lib/walking-route.mjs";

const ROUTER_TIMEOUT_MS = 8_000;

export const runtime = "nodejs";

export async function POST(request) {
  let stops;

  try {
    const body = await request.json();
    stops = validateRouteStops(body?.stops ?? body?.coordinates);
  } catch {
    return Response.json(
      { error: "Provide 2 to 5 valid route stops." },
      { status: 400 },
    );
  }

  try {
    const routeUrl = buildFootRouteUrl(
      stops,
      process.env.WALKING_ROUTER_URL || undefined,
    );
    const appOrigin = new URL(request.url).origin;
    const response = await fetch(routeUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "GloryMap-Hackathon/1.0 (+https://github.com/walklikeaman/codex-hackathon-starter)",
        Referer: `${appOrigin}/`,
      },
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Walking router responded with ${response.status}`);
    }

    const routerPayload = await response.json();
    const route = parseFootRoute(routerPayload);
    const rawRoute = routerPayload.routes[0];

    return Response.json({
      ...route,
      distanceMeters: rawRoute.distance,
      durationSeconds: rawRoute.duration,
      source: "openstreetmap-foot",
    });
  } catch (error) {
    console.error("Walking route request failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return Response.json(
      { error: "The walking router is temporarily unavailable." },
      { status: 502 },
    );
  }
}
