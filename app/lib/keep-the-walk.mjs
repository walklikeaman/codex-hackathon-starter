// Fetching the corridor, once, so the cache has it before the walk does (#161).
//
// The arithmetic is in tile-corridor.mjs. This is the part that talks to the map and the
// network: where the tile URLs come from, and what to do with a source that will not say.
//
// **The URLs are asked of the style, not guessed.** MapLibre resolves a TileJSON `url` into
// a `tiles` array once the source loads, so the template we fetch is the template the map
// itself is drawing from — including its key. A hard-coded MapTiler URL would keep the
// wrong tiles the day the basemap changes, and keep nothing at all on OpenFreeMap.

import { corridorTiles, tileUrl } from "./tile-corridor.mjs";

// Every raster or vector source the style is drawing from, as URL templates.
export function tileTemplates(map) {
  const style = typeof map?.getStyle === "function" ? map.getStyle() : null;
  const sources = style?.sources ?? {};
  const templates = [];

  for (const id of Object.keys(sources)) {
    const declared = sources[id];
    if (declared?.type !== "vector" && declared?.type !== "raster") continue;

    // The loaded source knows more than the style declaration: a TileJSON `url` has become
    // a `tiles` array by the time the map has drawn anything.
    const loaded = typeof map.getSource === "function" ? map.getSource(id) : null;
    const tiles = loaded?.tiles ?? declared?.tiles;
    if (!Array.isArray(tiles)) continue;

    for (const template of tiles) {
      if (typeof template === "string" && template.includes("{z}")) templates.push(template);
    }
  }

  return [...new Set(templates)];
}

// Fetch politely: four at a time, and never let one failure stop the rest. A tile that does
// not arrive is a tile the walk will ask for again on the day — which is exactly what
// happened before this existed, so a failure here costs nothing that was not already lost.
async function fetchAll(urls, { fetchImpl = fetch, concurrency = 4 } = {}) {
  let kept = 0;
  let failed = 0;

  for (let index = 0; index < urls.length; index += concurrency) {
    const batch = urls.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        const response = await fetchImpl(url, { mode: "cors", credentials: "omit" });
        return response.ok;
      } catch {
        return false;
      }
    }));
    for (const ok of results) { if (ok) kept += 1; else failed += 1; }
  }

  return { kept, failed };
}

// Keep the tiles along one route. Returns what happened, in numbers the UI can say out loud
// — a prefetch that reports nothing is indistinguishable from one that did nothing.
export async function keepTheWalk(map, positions, { fetchImpl, ...options } = {}) {
  const templates = tileTemplates(map);
  if (templates.length === 0) return { kept: 0, failed: 0, tiles: 0, truncated: false, reason: "no_tile_source" };

  const { tiles, truncated, wanted } = corridorTiles(positions, options);
  if (tiles.length === 0) return { kept: 0, failed: 0, tiles: 0, truncated: false, reason: "no_route" };

  const urls = [];
  for (const tile of tiles) {
    for (const template of templates) {
      const url = tileUrl(template, tile);
      if (url) urls.push(url);
    }
  }

  const { kept, failed } = await fetchAll(urls, { fetchImpl });
  return { kept, failed, tiles: tiles.length, wanted, truncated, reason: null };
}
