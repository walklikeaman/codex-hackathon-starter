import { NextResponse } from "next/server";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

export async function GET(request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length > 80) {
    return NextResponse.json({ error: "Enter a city name up to 80 characters" }, { status: 400 });
  }

  const endpoint = new URL(NOMINATIM_ENDPOINT);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("featuretype", "city");
  endpoint.searchParams.set("limit", "1");

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "GloryMap/1.0 (city search for story locations)",
      },
      next: { revalidate: 86400 },
    });
    if (!response.ok) throw new Error(`Nominatim responded with ${response.status}`);

    const [city] = await response.json();
    const lat = Number(city?.lat);
    const lng = Number(city?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "City not found" }, { status: 404 });
    }

    return NextResponse.json(
      { name: city.display_name.split(",")[0], lat, lng },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    console.error("City search failed", error);
    return NextResponse.json({ error: "Unable to search for a city" }, { status: 502 });
  }
}
