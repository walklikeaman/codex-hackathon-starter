// The MapLibre map, on its own route while the migration runs (#202).
//
// Not a product page. It exists so phase 2 can be MEASURED — the acceptance for #197 is a
// frame rate over Los Angeles with a thousand pins up, and that cannot be measured against
// a map that is half Leaflet and half MapLibre. When phase 3 moves the rest of the overlays
// across, this route is what the main map becomes, and it goes away.

import VectorMap from "../components/VectorMap.jsx";

export const metadata = {
  title: "GloryMap · vector map preview",
  // A work-in-progress route must not turn up in search results for the product.
  robots: { index: false, follow: false },
};

export default async function MapNextPage({ searchParams }) {
  // `?bare=1` draws the basemap and none of our layers, to tell a broken layer apart from a
  // broken map.
  const params = await searchParams;

  return (
    <main className="vector-map-page">
      <VectorMap bare={params?.bare === "1"} />
    </main>
  );
}
