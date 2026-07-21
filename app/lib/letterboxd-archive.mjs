import JSZip from "jszip";
import { mergeLibraries, parseMediaCsv } from "./media-library.mjs";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_CSV_CHARACTERS = 10 * 1024 * 1024;

export async function parseLetterboxdArchive(data, size = data.byteLength) {
  if (size > MAX_ARCHIVE_BYTES) {
    throw new Error("The Letterboxd ZIP must be smaller than 25 MB.");
  }

  let archive;
  try {
    archive = await JSZip.loadAsync(data);
  } catch {
    throw new Error("This file is not a readable Letterboxd ZIP export.");
  }

  const watchedFile = archive.file("watched.csv");
  const ratingsFile = archive.file("ratings.csv");
  if (!watchedFile && !ratingsFile) {
    throw new Error("The ZIP must contain watched.csv or ratings.csv at its top level.");
  }

  const [watchedText, ratingsText] = await Promise.all([
    watchedFile?.async("text") ?? "",
    ratingsFile?.async("text") ?? "",
  ]);
  if (watchedText.length + ratingsText.length > MAX_CSV_CHARACTERS) {
    throw new Error("The Letterboxd CSV data is too large to import safely.");
  }

  const watched = watchedText ? parseMediaCsv(watchedText, "letterboxd") : [];
  const ratings = ratingsText ? parseMediaCsv(ratingsText, "letterboxd") : [];
  return mergeLibraries(watched, ratings);
}
