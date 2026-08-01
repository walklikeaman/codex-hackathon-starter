import assert from "node:assert/strict";
import test from "node:test";

import {
  apiError,
  articleTitleFromEntity,
  buildEntitiesUrl,
  buildSectionUrl,
  buildTocUrl,
  chooseSection,
  cleanWikitext,
  isStorableQuote,
  MAX_QUOTE_WORDS,
  MIN_REQUEST_GAP_MS,
  permalink,
  stripNonFreeQuotes,
  USER_AGENT,
  wikipediaAttribution,
  WIKIPEDIA_LICENSE,
} from "../app/lib/wikipedia-source.mjs";

// --- identity -------------------------------------------------------------------

test("the User-Agent names a real contact, because Wikimedia 403s anything less", () => {
  // Verified live: a missing or library-default agent is refused outright, not slowed.
  assert.match(USER_AGENT, /https?:\/\//);
  assert.match(USER_AGENT, /@/);
  assert.equal(/example\./i.test(USER_AGENT), false);
  assert.equal(/^(curl|python-requests|node-fetch|axios)\//i.test(USER_AGENT), false);
});

test("the pace is well under the documented ceiling", () => {
  // The 200/min limit carries a "subject to change" note, and nothing here is urgent.
  assert.ok(MIN_REQUEST_GAP_MS >= 1000);
});

// --- the calls ------------------------------------------------------------------

test("entity lookups respect the API's own batch ceiling", () => {
  assert.match(buildEntitiesUrl(["Q1", "Q2"]), /ids=Q1%7CQ2/);
  assert.match(buildEntitiesUrl(["Q1"]), /sitefilter=enwiki/);
  assert.match(buildEntitiesUrl(["Q1"]), /maxlag=5/);
  assert.equal(buildEntitiesUrl(Array.from({ length: 51 }, (_, i) => `Q${i + 1}`)), null);
  assert.equal(buildEntitiesUrl(["not-a-qid"]), null);
  assert.equal(buildEntitiesUrl([]), null);
});

test("a work with no English article is skipped, never guessed at", () => {
  // A constructed title lands on the wrong page or a disambiguation, and looks
  // exactly like a real answer.
  assert.equal(articleTitleFromEntity({ sitelinks: { enwiki: { title: "Skyfall" } } }), "Skyfall");
  assert.equal(articleTitleFromEntity({ sitelinks: {} }), null);
  assert.equal(articleTitleFromEntity(null), null);
});

test("the section list uses tocdata, not the deprecated sections prop", () => {
  const url = buildTocUrl("Skyfall");
  assert.match(url, /prop=tocdata/);
  assert.equal(/prop=sections/.test(url), false);
  assert.match(url, /redirects=1/);
});

test("a section is fetched by index, and only by an index", () => {
  assert.match(buildSectionUrl("Skyfall", "8"), /section=8/);
  // A name is not a valid section selector anywhere in the Action API.
  assert.equal(buildSectionUrl("Skyfall", "Production"), null);
  assert.equal(buildSectionUrl("", "8"), null);
});

// --- choosing the section --------------------------------------------------------

const toc = (sections) => ({ sections });

test("the h2 Production wins over its Filming child", () => {
  // MediaWiki returns the whole subtree, so the parent brings Development, Filming
  // and Locations in one call; asking for the child throws its siblings away.
  const chosen = chooseSection(toc([
    { line: "Plot", index: "1", hLevel: 2 },
    { line: "Production", index: "4", hLevel: 2 },
    { line: "Filming", index: "6", hLevel: 3 },
  ]));
  assert.equal(chosen.index, "4");
});

test("index is returned, never number — they differ and the number is silently wrong", () => {
  // On "Lost in Translation (film)" Production is index 8, number 4. Passing the
  // number returns different prose, which is worse than an error.
  const chosen = chooseSection(toc([
    { line: "Production", index: "8", number: "4", hLevel: 2 },
  ]));
  assert.equal(chosen.index, "8");
});

test("a differently-named section is still found by rank", () => {
  const chosen = chooseSection(toc([
    { line: "Plot", index: "1", hLevel: 2 },
    { line: "Principal photography", index: "5", hLevel: 3 },
  ]));
  assert.equal(chosen.index, "5");
});

test("an article with no production section is skipped cleanly", () => {
  // Real articles have none; this is a normal outcome, not a failure.
  assert.equal(chooseSection(toc([{ line: "Plot", index: "1", hLevel: 2 }])), null);
  assert.equal(chooseSection(toc([])), null);
  assert.equal(chooseSection(null), null);
});

test("a section with no usable index is refused", () => {
  assert.equal(chooseSection(toc([{ line: "Production", index: "", hLevel: 2 }])), null);
});

// --- errors ----------------------------------------------------------------------

test("an error arriving with HTTP 200 is still an error", () => {
  // Wikimedia answers a missing page with 200 and an error body; checking the status
  // code alone reports success for an article that does not exist.
  assert.match(apiError({ error: { code: "missingtitle", info: "no page" } }), /missingtitle/);
  assert.equal(apiError({ parse: { revid: 1 } }), null);
  assert.equal(apiError(null), null);
});

// --- text ------------------------------------------------------------------------

test("third-party quoted material is removed before anything is considered", () => {
  // Wikipedia carries these under its OWN fair-use policy — they are not CC BY-SA, so
  // the licence gives us nothing for them.
  const text = stripNonFreeQuotes(
    'Filming began. <blockquote>"We shot it all in Glencoe," said Mendes.</blockquote> Later, Istanbul.',
  );
  assert.equal(text.includes("Mendes"), false);
  assert.ok(text.includes("Istanbul"));

  const templated = stripNonFreeQuotes("Before {{Quote|A borrowed line.}} after");
  assert.equal(templated.includes("borrowed line"), false);
});

test("wikitext becomes prose a person could read aloud", () => {
  const clean = cleanWikitext(
    "Filming took place at [[Glencoe|Glencoe, Scotland]]<ref name=\"a\" /> and "
    + "[[Hashima Island]].{{rp|13}} [[File:Set.jpg|thumb|The set]] '''Bold''' text.",
  );
  assert.ok(clean.includes("Glencoe, Scotland"));
  assert.ok(clean.includes("Hashima Island"));
  assert.equal(/<ref|\{\{|\[\[|File:/.test(clean), false, "no markup may survive");
  assert.equal(clean.includes("Bold text"), true);
});

test("nested templates are stripped rather than half-stripped", () => {
  const clean = cleanWikitext("Shot in Rome {{efn|see {{harvnb|Smith|2001}} for detail}} in 1953.");
  assert.equal(/\{\{|\}\}/.test(clean), false);
  assert.ok(clean.includes("Rome"));
  assert.ok(clean.includes("1953"));
});

// --- quotes ----------------------------------------------------------------------

test("a stored quote is one short sentence, not a passage", () => {
  assert.equal(isStorableQuote("Filming took place at Hankley Common in Surrey."), true);
  assert.equal(isStorableQuote(`${"word ".repeat(MAX_QUOTE_WORDS + 5)}.`), false);
  assert.equal(isStorableQuote("One sentence. And then a second one."), false);
  assert.equal(isStorableQuote(""), false);
  assert.equal(isStorableQuote(null), false);
});

// --- attribution ------------------------------------------------------------------

test("attribution carries both halves the licence requires", () => {
  // Crediting the author and giving the licensing notice are SEPARATE obligations;
  // "Source: Wikipedia" plus a link satisfies only the first.
  const credit = wikipediaAttribution({ title: "Skyfall", revid: 123456 });
  assert.match(credit.notice, /Wikipedia, "Skyfall"/);
  assert.match(credit.notice, /CC BY-SA 4\.0/);
  assert.equal(credit.license_url, WIKIPEDIA_LICENSE.url);
  assert.match(credit.article_url, /en\.wikipedia\.org\/wiki\/Skyfall/);
});

test("the exact revision is pinned, which is what settles the licence version", () => {
  // A revision after 7 June 2023 is unambiguously 4.0; without oldid the credit
  // points at text that may since have changed entirely.
  assert.match(permalink("Lost in Translation (film)", 987654), /oldid=987654/);
  assert.match(permalink("Lost in Translation (film)", 987654), /title=Lost_in_Translation/);
  assert.equal(permalink("Skyfall", null), null);
});

test("a trimmed quote says so", () => {
  const credit = wikipediaAttribution({ title: "Skyfall", revid: 1, modified: true });
  assert.match(credit.notice, /\(modified\)/);
  assert.equal(credit.modified, true);
});

test("no title means no attribution, and therefore nothing to publish", () => {
  assert.equal(wikipediaAttribution({ title: null, revid: 1 }), null);
});
