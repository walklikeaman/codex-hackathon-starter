const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

export function parseTmdbMovieId(value) {
  const id = String(value ?? "");
  return /^[1-9]\d*$/.test(id) ? id : null;
}

export function selectTmdbBackdrop(images) {
  if (!Array.isArray(images)) return null;

  return images
    .filter((image) => /^\/[A-Za-z0-9._-]+$/.test(image?.file_path ?? ""))
    .sort((left, right) =>
      (Number(right.vote_count) || 0) - (Number(left.vote_count) || 0)
      || (Number(right.vote_average) || 0) - (Number(left.vote_average) || 0)
      || (Number(right.width) || 0) - (Number(left.width) || 0),
    )[0] ?? null;
}

export function tmdbImageUrl(filePath, size = "w780") {
  if (!/^\/[A-Za-z0-9._-]+$/.test(filePath ?? "")) return null;
  if (!/^(?:original|w\d+)$/.test(size)) return null;
  return `${TMDB_IMAGE_BASE_URL}/${size}${filePath}`;
}
