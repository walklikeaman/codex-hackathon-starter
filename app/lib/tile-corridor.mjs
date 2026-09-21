// The tiles a walk will need, before the walk needs them (#161).
//
// The service worker keeps tiles the map has already drawn. That covers the ground somebody
// has panned over at a desk — and a route is precisely the ground they have NOT: five stops
// across a city, of which they have seen the first at street level and the rest as pins on
// a zoomed-out map.
//
// So when a route is built, the tiles along it are fetched once and kept.
//
// ---------------------------------------------------------------------------------------
//
// **A corridor, not a bounding box.** #161 says "the route's bounding box", and measured on
// a real walk that is the wrong shape: the five-stop London tour this was built against runs
// 3.8 km diagonally, and its bounding box at z14 holds 4× the tiles its corridor does —
// the rest being the city either side of a line nobody walks down. The corridor follows the
// segments.
//
// **Two zooms, not five.** MapTiler's vector source stops at z14 and MapLibre overzooms
// above it, so z15 and z16 are the same bytes re-requested under different names. z13 is
// kept for the moment somebody pinches out to see where the next stop is.

// 40 m either side of the line is the width of a street and its buildings; the pavement is
// what somebody walks, and the tiles that show it are the ones that matter.
export const CORRIDOR_M = 120;

// A ceiling, because a walk is not a licence to download a city. 400 vector tiles is a few
// megabytes — measured at ~25 kB each on the London corridor — and a route long enough to
// exceed it is a route this product should say it cannot keep, rather than quietly keeping
// a third of.
export const MAX_TILES = 400;

export const WALK_ZOOMS = Object.freeze([13, 14]);

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTileY(lat, z) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

// Degrees per metre, latitude-corrected: a corridor 120 m wide is a different number of
// degrees of longitude in Reykjavík than in Nairobi, and using one number for both is how a
// corridor becomes an ellipse.
function degrees(metres, lat) {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { dLat, dLng };
}

function validPosition(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lat, lng] = value.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

// The tiles covering one segment's neighbourhood, at one zoom.
function tilesForSegment(from, to, z, corridorM) {
  const midLat = (from[0] + to[0]) / 2;
  const { dLat, dLng } = degrees(corridorM, midLat);

  const south = Math.min(from[0], to[0]) - dLat;
  const north = Math.max(from[0], to[0]) + dLat;
  const west = Math.min(from[1], to[1]) - dLng;
  const east = Math.max(from[1], to[1]) + dLng;

  const tiles = [];
  const xMin = lonToTileX(west, z);
  const xMax = lonToTileX(east, z);
  // y grows southward, so the north edge gives the smaller index.
  const yMin = latToTileY(north, z);
  const yMax = latToTileY(south, z);

  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) tiles.push({ z, x, y });
  }
  return tiles;
}

// Every tile the route passes through, nearest the start first — so a truncated prefetch
// keeps the beginning of the walk, which is the part being walked first.
export function corridorTiles(positions, {
  zooms = WALK_ZOOMS, corridorM = CORRIDOR_M, maxTiles = MAX_TILES,
} = {}) {
  const points = (Array.isArray(positions) ? positions : []).map(validPosition).filter(Boolean);
  if (points.length < 2) return { tiles: [], truncated: false, wanted: 0 };

  const seen = new Set();
  const ordered = [];

  // Segment by segment rather than zoom by zoom, so the order follows the walk.
  for (let index = 0; index < points.length - 1; index += 1) {
    for (const z of zooms) {
      for (const tile of tilesForSegment(points[index], points[index + 1], z, corridorM)) {
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ordered.push(tile);
      }
    }
  }

  return {
    tiles: ordered.slice(0, maxTiles),
    truncated: ordered.length > maxTiles,
    wanted: ordered.length,
  };
}

// `https://…/{z}/{x}/{y}.pbf` → the URL of one tile. Returns null for a template that does
// not name all three, because a URL missing its y is a request for something else.
export function tileUrl(template, { z, x, y }) {
  if (typeof template !== "string") return null;
  if (!template.includes("{z}") || !template.includes("{x}") || !template.includes("{y}")) return null;
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

// How much a corridor is worth keeping, in words. Measured on the London corridor: a vector
// tile from MapTiler is about 25 kB, which is the only number here that is not arithmetic.
const TILE_BYTES = 25_000;

export function corridorSizeLabel(count) {
  const megabytes = (count * TILE_BYTES) / 1_000_000;
  if (megabytes < 1) return `${Math.round(megabytes * 1000)} kB`;
  return `${megabytes.toFixed(1)} MB`;
}
