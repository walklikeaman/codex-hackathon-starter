function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function cleanHeader(value) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function firstValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[alias]?.trim();
    if (value) return value;
  }
  return null;
}

function numberValue(value) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function libraryKey(movie) {
  return movie.imdbId || `${movie.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${movie.year ?? ""}`;
}

export function parseMediaCsv(text, source) {
  if (!new Set(["letterboxd", "imdb"]).has(source)) throw new Error("Unsupported media source");
  const [headerRow, ...dataRows] = parseCsvRows(text);
  if (!headerRow) throw new Error("The CSV file is empty");

  const headers = headerRow.map(cleanHeader);
  const movies = dataRows.flatMap((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    const title = firstValue(record, ["name", "title", "original title"]);
    if (!title) return [];

    const imdbId = firstValue(record, ["const", "imdb id"]);
    const rating = numberValue(firstValue(record, ["rating", "your rating"]));
    const year = numberValue(firstValue(record, ["year", "release year"]));
    const watchedDate = firstValue(record, ["watched date", "date rated", "date"]);
    const url = firstValue(record, ["letterboxd uri", "url"]);

    return [{
      id: imdbId || `${source}:${libraryKey({ title, year })}`,
      title,
      year,
      rating,
      watchedDate,
      url,
      imdbId: imdbId && /^tt\d+$/.test(imdbId) ? imdbId : null,
      sources: [source],
    }];
  });

  if (!movies.length) throw new Error("No movie titles were found in this CSV");
  return movies;
}

export function mergeLibraries(current, imported) {
  const merged = new Map(current.map((movie) => [libraryKey(movie), movie]));

  for (const movie of imported) {
    const key = libraryKey(movie);
    const previous = merged.get(key);
    merged.set(key, previous ? {
      ...previous,
      ...movie,
      rating: movie.rating ?? previous.rating,
      watchedDate: movie.watchedDate ?? previous.watchedDate,
      url: movie.url ?? previous.url,
      sources: [...new Set([...(previous.sources ?? []), ...movie.sources])],
    } : movie);
  }

  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
}
