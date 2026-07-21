const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

export function parseTmdbMovieId(value) {
  const id = String(value ?? "");
  return /^[1-9]\d*$/.test(id) ? id : null;
}

export function filmLocationImageKey(tmdbId, locationId) {
  const filmId = parseTmdbMovieId(tmdbId);
  const placeId = String(locationId ?? "").trim();
  return filmId && placeId ? `${filmId}:${placeId}` : null;
}

export function selectTmdbBackdrops(images, limit = 8) {
  if (!Array.isArray(images)) return [];
  if (!Number.isInteger(limit) || limit < 1) return [];

  const uniqueImages = new Map();

  for (const image of images) {
    if (!/^\/[A-Za-z0-9._-]+$/.test(image?.file_path ?? "")) continue;
    if (!uniqueImages.has(image.file_path)) uniqueImages.set(image.file_path, image);
  }

  return [...uniqueImages.values()]
    .sort((left, right) =>
      (Number(right.vote_count) || 0) - (Number(left.vote_count) || 0)
      || (Number(right.vote_average) || 0) - (Number(left.vote_average) || 0)
      || (Number(right.width) || 0) - (Number(left.width) || 0),
    )
    .slice(0, limit);
}

export function selectTmdbBackdrop(images) {
  return selectTmdbBackdrops(images, 1)[0] ?? null;
}

export function tmdbImageUrl(filePath, size = "w780") {
  if (!/^\/[A-Za-z0-9._-]+$/.test(filePath ?? "")) return null;
  if (!/^(?:original|w\d+)$/.test(size)) return null;
  return `${TMDB_IMAGE_BASE_URL}/${size}${filePath}`;
}
