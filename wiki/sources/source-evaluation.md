# Sources we looked at and did not take

## Correction 05.08.2026: not a commercial project

The owner clarified: this is a student demo and it is **not sold**. Restrictions of
licence TYPE (CC BY-NC, non-commercial model weights) therefore stop blocking — their
conditions are honoured as written, and all of it is revisited the moment selling is
discussed.

**Refusals below that rest on terms of use still stand.** Terms forbid the ACT, not the
earnings, so scraping IMDb or Reelstreets is forbidden regardless of money. The same goes
for frame corpora whose owners hold no rights to the frames: non-commercial use of
somebody else's work without rights is still use without rights.

The rule: **a licence says on what terms you may; a site's terms say whether you may at
all.**

**Owner's decision 05.08 on sources in general:** collect any source and mark it
unverified rather than discarding the lead. "Somebody said something happened here" is
worth showing when the card says exactly that and names who said it.



Recording a refusal is worth as much as recording a build: without this, the same
appealing idea comes back every few weeks and gets researched again.

## IMDb — no, and there is no paid path

Three independent bars, any one fatal:

1. **Conditions of Use** carry a standalone prohibition on "data mining, robots, or
   similar data gathering and extraction tools" without written consent. No volume or
   hobby carve-out.
2. The user licence is **personal, non-commercial, no download beyond page caching**.
   Storing images and re-presenting them on a map is exactly the withheld conduct.
3. **IMDb does not own most of the photos** — the Conditions say "IMDb *or its content
   suppliers*".

The third is why there is nothing to negotiate: **no licensing department sells IMDb
image rights**, because they are not IMDb's to sell. Asking is the wrong request to the
wrong party.

Everything IMDb was wanted for is already available: identifiers via Wikidata P345 and
TMDB, bulk metadata via IMDb's own published datasets (no images in either).

## Fandom — no, and the reason is not licensing

Verified live via `action=query&meta=siteinfo&siprop=rightsinfo`:

| wiki | licence |
|---|---|
| harrypotter, jamesbond, lotr | CC-BY-SA (farm default) |
| memory-alpha | **CC-BY-NC** |
| minecraft | **CC BY-NC-SA** |

**A correction to the obvious advice:** "read the licence from `url`, not `text`" fails
on its own example — Minecraft declares `CC BY-NC-SA` in the *text* while pointing at the
farm-default *URL*. Both must agree; disagreement means stop.

**Images are an absolute block, separate from all of that.** The site licence covers text
only. Fandom images are overwhelmingly studio material under an unstructured fair-use
claim by an anonymous uploader. That is not a licence and does not transfer, and unlike
Wikimedia there is no per-file metadata to check.

But the decisive reason is evidential, not legal. Checked live: the "Filming locations"
category is **empty on the Bond, LOTR and Harry Potter wikis**. And a Fandom row would
satisfy the *letter* of our guarantee — named page, verbatim quote, stored permalink —
while the underlying claim is anonymous and unsourced. To verify it a reviewer must find
an independent source, at which point **that** source is the citation and Fandom
contributed a name. Cost per pin rises, evidential value goes to zero, and the badge on
the map looks identical to a properly cited one.

## Frame corpora — real frames, no licence

Film-Grab (~4,099 posts) and Movie-Screencaps (~1,361) both expose open WordPress REST
APIs with full-resolution URLs. **Neither owns the frames.** A permissive footer grants
nothing when the copyright is the studio's. Technically open, legally unusable — and
that will not change with time.

Getty and Alamy editorial frame grabs *are* genuinely licensed per asset, and per-asset
pricing kills an archive. Shutterstock's editorial terms explicitly forbid "displaying
content as a 'gallery' … through which third parties may search", which is a description
of this product.

## The trap worth remembering: a fictional place that geocodes cleanly

Our homonym rule refuses **Cambridge vs Cambridge** — two real places, genuine ambiguity.
It does nothing against **Derry, Gotham, Springfield, Amity**, which resolve to exactly
one real settlement, confidently. A fictional place that geocodes cleanly is the
*best-looking* row in the review queue and the one most likely to be waved through.

Current exposure is low: narrative places only ever map into our own closed list
(`known_place` in [[demo-path]]'s story trail) and never reach the geocoder from free
text. This is the trap waiting for the books branch, and the check has to run **before**
the geocoder — not as "ask the model whether it's fictional".

## Ranked, for next time

1. **City filming-permit open data** — see [[film-permits]]. Primary records, geocoded by
   the issuer, open licence.
2. **Wikivoyage** — CC BY-SA 4.0, same MediaWiki machinery already built, and listing
   templates carry coordinates so the gazetteer is bypassed entirely.
3. **More Wikipedia languages and sections** — already built, marginal cost near zero.
4. **OpenStreetMap** — under ~100 filming-tagged objects worldwide. Keep it as the
   geocoding target it already is, never as a source of the work→place claim.
5. **Fandom** — below the threshold.

See also: [[film-permits]], [[film-frames]], [[wikipedia-enrichment]].
