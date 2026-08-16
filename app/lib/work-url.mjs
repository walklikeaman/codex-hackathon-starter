// Where a film lives, as an address somebody can send to somebody else.
//
// Measured before writing this: the app has exactly ONE page. 6,392 works hold at least
// one located place and not one of them has a URL — everything we know is reachable only
// by typing a title into a box and dragging a map. Nothing to share, nothing to index,
// nothing to come back to.
//
// The slug carries a UUID because that is what identifies a work here, and a readable
// prefix because a bare UUID in a shared link tells the person receiving it nothing. The
// prefix is decorative and the parser proves it: change "skyfall-2012" to anything at all
// and the page still resolves. That is deliberate — a title that gets corrected later must
// not break links that were already sent.
//
// A per-work slug COLUMN would be nicer and is #158's problem, not this one: it needs a
// migration, a uniqueness rule and a redirect for every renamed work. This needs neither
// and can be replaced without breaking the links it has already produced.

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// The separator is a DOUBLE hyphen: single hyphens are how the readable half is spelled,
// so splitting on one would cut "the-third-man" in the wrong place.
const SEPARATOR = "--";

export function slugifyTitle(title) {
  return String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function workSlug(work) {
  const id = String(work?.id ?? "");
  if (!UUID.test(id)) return null;
  const readable = [slugifyTitle(work?.title), work?.year].filter(Boolean).join("-");
  return readable ? `${readable}${SEPARATOR}${id}` : id;
}

export function workPath(work) {
  const slug = workSlug(work);
  return slug ? `/work/${slug}` : null;
}

// The id is the last thing after the separator, or the whole slug when there is no
// readable half. Anything that is not a UUID is not a work, and the page says so rather
// than querying for it.
export function workIdFromSlug(slug) {
  const text = String(slug ?? "");
  const index = text.lastIndexOf(SEPARATOR);
  const candidate = index === -1 ? text : text.slice(index + SEPARATOR.length);
  return UUID.test(candidate) ? candidate.toLowerCase() : null;
}
