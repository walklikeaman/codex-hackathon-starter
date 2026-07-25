// Wikimedia Commons file metadata — the author and licence a Commons image legally
// needs before we may display it.
//
// Commons licences are PER FILE: the site as a whole grants nothing. Knowing that a
// photo came from Commons is therefore not enough to publish it — we need who took it
// and under what terms. This module fetches exactly that, so attribution.mjs's
// fail-safe has real data to pass instead of always refusing.

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

// The filename inside a Special:FilePath URL, which is what P18 gives us.
export function commonsFileTitle(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith("wikimedia.org")) return null;

  const filePath = parsed.pathname.match(/\/Special:FilePath\/(.+)$/);
  if (filePath) return `File:${decodeURIComponent(filePath[1])}`;

  // upload.wikimedia.org/.../a/ab/Name.jpg — the last segment is the file.
  const upload = parsed.pathname.match(/\/([^/]+\.(?:jpg|jpeg|png|gif|webp|svg))$/i);
  return upload ? `File:${decodeURIComponent(upload[1])}` : null;
}

export function buildCommonsMetadataUrl(titles) {
  const list = [...new Set((Array.isArray(titles) ? titles : []).filter(Boolean))];
  if (list.length === 0 || list.length > 50) {
    throw new Error("Commons metadata requires between 1 and 50 file titles");
  }
  const endpoint = new URL(COMMONS_API);
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("titles", list.join("|"));
  endpoint.searchParams.set("prop", "imageinfo");
  endpoint.searchParams.set("iiprop", "extmetadata");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  return endpoint;
}

// extmetadata values are HTML fragments ("<a href=…>Diliff</a>"). Take the text.
function plainText(value) {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text.slice(0, 160) : null;
}

// Parse the API payload into attribution input keyed by file title. A file whose
// author or licence is missing is returned WITHOUT them, so the caller's fail-safe
// decides — this module never invents a credit.
export function parseCommonsMetadata(payload) {
  const pages = payload?.query?.pages;
  const byTitle = new Map();
  if (!pages || typeof pages !== "object") return byTitle;

  for (const page of Object.values(pages)) {
    const title = page?.title;
    if (!title || page.missing !== undefined) continue;
    const meta = page.imageinfo?.[0]?.extmetadata;
    if (!meta) continue;

    byTitle.set(title, {
      source: "wikimedia",
      author: plainText(meta.Artist?.value),
      license: plainText(meta.LicenseShortName?.value),
      license_url: typeof meta.LicenseUrl?.value === "string" ? meta.LicenseUrl.value : null,
      source_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    });
  }
  return byTitle;
}

// Fetch attribution for a batch of Commons image URLs. Returns Map(url → attribution).
// A failure is not fatal: the caller simply gets no attribution for those images, and
// the fail-safe hides them rather than publishing them uncredited.
export async function fetchCommonsAttribution(urls, {
  fetchImpl = (...args) => fetch(...args),
  userAgent = "GloryMap/1.1 (https://codex-hackathon-starter.vercel.app/)",
  signal,
  revalidate = 86400,
} = {}) {
  const titleByUrl = new Map();
  for (const url of Array.isArray(urls) ? urls : []) {
    const title = commonsFileTitle(url);
    if (title) titleByUrl.set(url, title);
  }
  if (titleByUrl.size === 0) return new Map();

  const response = await fetchImpl(buildCommonsMetadataUrl([...titleByUrl.values()]), {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal,
    next: { revalidate },
  });
  if (!response.ok) throw new Error(`Commons responded with ${response.status}`);

  const byTitle = parseCommonsMetadata(await response.json());
  const byUrl = new Map();
  for (const [url, title] of titleByUrl) {
    const attribution = byTitle.get(title);
    if (attribution) byUrl.set(url, attribution);
  }
  return byUrl;
}
