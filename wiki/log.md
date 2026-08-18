# Wiki Log

Append-only, newest-first. One entry per meaningful operation.
Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | <short title>`

Tip: `grep "^## \[" log.md | head -20` shows recent activity.

---

## [2026-08-19] update | A city is a point and a radius, and the catalogue almost pointed at 6,378 empty rooms

**Object**: `app/lib/{city-gazetteer,directory,submission-places,work-card}.mjs`,
`app/api/directory/{cities,city,films}/route.js`, `app/{directory,city}/**`, `app/sitemap.js`,
`app/api/work/route.js`, `supabase/migrations/2026081821*.sql`, `scripts/build-city-gazetteer.sql`
**Scenario**: feature (#158) · **Outcome**: ✅ success
**Code changes**: this commit

**The product had two surfaces and now has three.** 6,392 works and 32,148 located rows had
no URL between them; there is now an index, 27 letter pages addressing every work, and 56
city pages, all server-rendered and in a sitemap.

**The decision the whole feature rests on is a refusal to trust a name.** Grouping the
located rows by the city written in their address gives "London" a spread of 10,959 km
(London, Ontario), "Richmond" 8,097 km, 48 works under "Ontario" — a province — and 80 under
"Unnamed Road". So a city page is a **disc**: a measured anchor and a 20 km radius, with the
name as decoration. It is the third time this project has learned that a name is not an
identifier, after `Bowie` on Overpass and `wbsearchentities` on Skyfall.

**Each rule in the gazetteer cost a measurement.** A country is the component that comes
LAST — Canada 1.000, France 0.912, Ireland 0.813 against Vancouver 0.000 — and without that
test "Canada" wins 902 names, lands on Vancouver's own coordinate and **shadows Vancouver off
the list**. The anchor is the MEDIAN, because the mean puts Paris in the Atlantic and the
densest point moves London to Greenwich, where 51 rows share one coordinate. A venue is a
name written always the same way, which is what removes "Mini Hollywood", "Bryant Park" and
"Bonneville Salt Flats", each arriving with 40-53 works looking like a small town. And of two
candidates within 40 km only the more-named survives — without it Westminster, Lambeth, St.
James's and City of Westminster each return **the same 656 works as London** and each gets
its own page, which is precisely the padded directory the issue asks us not to build.

**Paris is added by hand and marked.** It fails the spread rule because two thirds of the
rows naming it are in Texas and Ontario. Loosening the rule enough to admit it also admits
"s/n" — Spanish for "no street number" — which takes 87 works and shadows Madrid. One
exception, stated, beat a threshold that lets in nonsense.

**The lie that nearly shipped, and it was found by clicking one link.** The directory is
built on the queue; the film card is built on the graph. The graph holds **92 facts across 15
works** and the catalogue holds **6,392** — so **14 of 6,392** rows led anywhere. Every other
row pointed at a card reading "No places recorded for this work yet", which is a worse answer
to #158 than no directory at all. The card now shows the queue on the map's terms since
05.08: labelled a candidate, linked to its source, kept out of `placeBlocks` entirely rather
than given a distance, because a fact has an identity and a subject and a queue row has
neither. The header counts them apart — *23 places · 15 filmed on location · 62 unverified
candidates* — and the block says "60 of 62" when it cannot print them all.

**Two smaller measurements worth keeping.** Filing the A-Z on the raw `title_norm` put
**1,427 of 6,392 works under T**, because half our sources write "The Dark Knight" and half
write "Bulls, The"; stripping only a LEADING article fixes both conventions at once and T
fell to 330. And the index first read "6,392 films with 20,296 places" — a global work count
beside a count of only what sits near a listed city. Two halves of one sentence have to be
measured over one set of rows.

**Verification.** 1,082 tests (+45), and every page driven live against production data from
this machine — the directory index, London (656 films, Killing Eve first with 78 places),
the `#` letter page, a page past the end folding back to the first, and both card states:
a work with only candidates and Skyfall with 23 facts beside 62 candidates. Supabase turned
out to be reachable from here, contrary to the note in the handoff.

**Updated**: `wiki/concepts/directory.md` (new), `wiki/index.md`, `wiki/handoff.md`,
`app/globals.css`, `test/{directory,directory-api,submission-places}.test.mjs`

## [2026-08-18] incident | The first live answer put the Olympics above Derry

**Object**: `app/lib/city-search.mjs`, `test/city-search.test.mjs`
**Scenario**: bugfix · **Outcome**: ✅ success
**Code changes**: this commit

**The smoke step added an hour earlier earned its keep on its first run.** Production
answered `/api/cities/suggest?q=lond` in 1.10 s with London first and its radius correctly
23 km from the stated area — and with **the 2012 Summer Olympics second, above Derry**.
An Olympiad carries a venue coordinate and 200 Wikipedias, `isPlaceType` only knows about
shipwrecks, and fame is the sort key, so it sailed through every filter the box has.

**A thing that happened is not a thing that is, and one property says so.** A city has no
start time. Candidates carrying P580 or P585 are dropped — no taxonomy, no subclass walk,
nothing that could cost the 65 seconds the closure once did.

The same answer also offered the University of London above Derry, which is a ranking
problem rather than a filter one: a settlement or an administrative area states how many
live there or how big it is, and a university, a bridge and a pub state neither. **Cities
and places, in that order** — inhabited first, fame only ordering within each band.

Worth naming plainly, because it is the third time this project has learned it: **this
class of defect is invisible to review and obvious to one live request.** The inverted
search has the same open note — "Eurovision Young Musicians 2018" for Harry Potter in
Edinburgh — found the same way. The development machine can reach neither Wikidata nor
Supabase nor the production domain, so a step that curls production after deploying is the
only instrument there is.

**Updated**: `wiki/concepts/search-box.md`

## [2026-08-18] update | One search box, and the city half could not be Nominatim

**Object**: `app/lib/city-search.mjs`, `app/api/cities/suggest/route.js`,
`app/components/{SearchBox.jsx,SceneMapApp.jsx}`, `app/lib/work-search.mjs`
**Scenario**: feature (#145) · **Outcome**: ✅ success
**Code changes**: this commit

**Two fields became one, and the interesting half of the work was not the merge.** A city
field and a title field sat next to each other, each hitting a different service, neither
able to suggest the other's kind. The box now answers both, grouped — films and books
first, cities and places under their own heading — with the kind obvious at a glance and
one keyboard walk through the two groups.

**The design rule is the refusal to average two latencies.** `/api/search` is one indexed
query on our own database; the gazetteer is a network call. Awaiting them together makes
the fast half as slow as the slow one on every keystroke, so they are two requests with
two debounces (140 ms and 320 ms) and two groups that paint independently. Films are
listed FIRST for a reason that is correctness rather than taste: the slower group must
grow the list downward, or its arrival pushes the row under the cursor out from under it.
For the same reason the cursor is held by KEY and not by index, and every request carries
a serial as well as an abort — an abort and a resolve can race, and the loser still calls
`setState`.

**The city half could not be built on the endpoint that already existed, and that is the
decision worth keeping.** `/api/cities` asks Nominatim, which is fine as it stands — one
request per submitted form. A type-ahead is a different act: the OSMF usage policy names
auto-complete search on the public instance as unacceptable use outright, the same policy
that already cost us the bulk path ([[geocoding-cascade]]). So suggestions come from
Wikidata through `wikibase:mwapi`: CC0, nothing owed, and the same entity search
Wikidata's own box runs. **Nominatim was not deleted and was not made a per-keystroke
fallback either** — that would hammer it on exactly the queries Wikidata cannot answer.
It sits behind one row, "Look “x” up as a place", offered when the gazetteer finds
nothing or does not answer. One request, clicked for.

**Two rules were inherited rather than re-derived, and both are already paid for.** No
`P279*` closure — 65 seconds and a 504 for a single name, measured in July; requiring a
coordinate does most of that work and `isPlaceType` drops the shipwrecks. And ranking by
`wikibase:sitelinks` rather than by label match, because `wbsearchentities` ranks by
string similarity and nothing else: London Q84 carries ~400 sitelinks against London,
Ontario's ~94, the same signal that stops "Skyfall" resolving to a lyric video.

**A failing gazetteer is a state, not an error.** The route answers 200 with
`unavailable: true`, so the box degrades into the search that existed before #145 instead
of into an error nobody can act on. Each empty state names which kind was searched.

**And the box now has somewhere to lead.** Every film row carries a real link to its card
at `/work/<slug>--<uuid>` — built by `workPath`, the function the page itself parses, so
the two cannot drift. Clicking the row still shows the film on the map: that is the
[[demo-path]], and a search box attached to a map should not navigate away from it.

**Verification, and its limit.** 1,037 tests (16 new), and the box driven with Playwright
against a production build: the film group paints while the city request is still open,
the city group appends below without moving the cursor, ArrowDown walks both groups as
one list, `aria-activedescendant` follows, Escape closes. What ran live here was the
DEGRADED path — Wikidata, Nominatim and Supabase are all unreachable from this machine
(filtered egress), so the ranking is covered by fixtures and the live shape is verified on
production after the deploy. The two `cancelled` results in `artwork-api.test.mjs` are
older than this change and reproduce on `main`.

**One step added to the production deploy**, because the verification this project keeps
having to do by hand is the one nothing automated: a deployment that succeeded is not a
site that answers, and a green commit status can belong to a Preview. The workflow now
asks the production domain by name after deploying and prints what `/api/search` and
`/api/cities/suggest` return. It is also the only way this session could see the WDQS
query answer at all — every external host is filtered from the development machine.

**Updated**: `wiki/concepts/search-box.md` (new), `wiki/index.md`,
`test/{city-search,work-search}.test.mjs`, `app/globals.css`,
`.github/workflows/deploy-production.yml`

## [2026-08-08] update | The scrape goes on a timer, and dry-run stops lying

**Object**: `scripts/refresh-sources.sh`, `.gitignore`
**Scenario**: feature · **Outcome**: ✅ success
**Code changes**: this commit

**One command now does the whole pass**, and it is safe on a timer because every
piece under it is incremental and idempotent: the harvesters compare each site's
own `<lastmod>` (or the WordPress API's `modified_after`) against the watermark
in `data/*/state.json` and fingerprint what they extracted, so a page that was
merely re-rendered is not re-read; the ingests upsert on `(work_id, place_key)`.
A run with nothing to do does nothing and says so.

**Two things a scheduled job must get right that a hand-run script can ignore.**
The Wikidata pass takes about 21 hours at a polite query rate, so without a lock
the next night's run would start on top of it and both would crawl the same
sites — `flock` holds the whole pipeline, with an atomic `mkdir` fallback because
macOS has no `flock(1)`. And cron gets a near-empty PATH and no shell profile, so
node, python and the keys are resolved explicitly rather than assumed. The
resolver takes 1,200 pins per run rather than all 27,000: it skips what it has
already answered, so a nightly slice drains the backlog over weeks without ever
holding the slot.

**`--dry-run` was lying twice, and both were found by the run timing out rather
than answering.** It promised to decide nothing and write nothing, but reached
only as far as the ingests — the harvesters still crawled three sites and spent
model calls before deciding to write nothing. And the resolver's own dry mode
skips the write while still querying WDQS, which is correct alone and wrong
inside a pipeline check: 1,200 pins at a polite rate is an hour to prove a step
is wired. Harvest and extract are now skipped explicitly under `--dry-run`, and
the resolver's budget drops to five. Seventy seconds, seven steps, no failures.

A failed step does not end the run — one site being down must not cost the other
two and every ingest — but failures are named at the end and the exit code is
non-zero. A scheduled job that fails quietly is worse than one that never ran:
the data looks fresh and is not.

**Updated**: `.gitignore` (the lock the job holds)

## [2026-08-08] incident | Cross-source matching found a defect in 54% of a source

**Object**: `tools/scraperai/movielocations.py`, `app/lib/{cross-source,wikidata-resolve}.mjs`,
`scripts/{corroborate-sources,resolve-wikidata}.mjs`,
`supabase/migrations/20260807213453`
**Scenario**: bugfix · **Outcome**: ✅ success
**Code changes**: this commit

**Nothing from three scrapes can reach the map, and measuring why came first.**
`place-review.mjs` weights `wikidata_entity` at 0.6 against a 0.6 threshold, so a
canonical entity is the only single signal that verifies — and `cited_source +
coordinate_agreement` combine by noisy-OR to 0.5875, just under. Not one of
44,088 submissions had a Q-id. A second wall sits in front of that one:
`disqualification()` refuses any row without a coordinate, and 13,819 have none.

**So: resolve pins to Wikidata by coordinate AND name.** Measured properly
before committing to a 21-hour run — 196 real pins, four candidate rules scored
on one fetch so they stayed comparable. The surprise was that "one name contains
the other" resolves FEWER than strict equality: a substring catches neighbours,
the case turns ambiguous, and an ambiguous case is correctly discarded. The
chosen rule drops a generic word only when BOTH names carry one, which is what
stops "Victoria Park" collapsing onto "Victoria". 28.1%, and the ceiling is the
data: 138 of 196 had some entity within 150 m but the rest are genuine
neighbours, and Wikidata holds no entry for an ordinary house.

**Cross-source corroboration earned its keep before writing a row.** Among pairs
it declined, rows appeared like `Skyfall location: Silva escapes into the
underground system: Ventilator …` — a whole caption sitting where a place name
belongs. The movie-locations regex demanded "filming location" or "film
location"; the site also writes plain "<Film> location:", and every one of those
failed to split. **3,125 of 5,783 rows, 54% of the source**, shipped yesterday,
past tests and past review, living a day in the database. Tests only checked
captions of the format that was anticipated. Fixed with one optional word,
re-parsed from cache with no network at all, the broken rows deleted (all
`pending`, nothing referencing them) and the source re-ingested: median place
name 84 → 37 characters, zero unsplit captions.

Corroboration itself is modest — 89 rows gain agreement, 81 of them a coordinate
they lacked — because sources write the same address very differently. Loosening
that match is the next real task, and it is judgement at a scale of thousands
rather than a rule.

**Updated**: `test/cross-source.test.mjs`, `wiki/concepts/movielocations-source.md`

## [2026-08-07] ingest | movie-locations.com, and three defects caught at the door

**Object**: `tools/scraperai/{movielocations,crawler}.py`,
`app/lib/movielocations-source.mjs`, `scripts/ingest-movielocations{,-works}.mjs`,
`scripts/ingest-reelstreets.mjs`, `supabase/migrations/20260807165200|165213`
**Scenario**: ingest · **Outcome**: ✅ success
**Code changes**: this commit

**A fifth source that needs no model at all.** movie-locations.com writes its
captions as "<film> filming location: <scene>: <address>", so a regex finds the
place during the scrape — no rate limit, no 14 hours, no chance of an invented
place. 1,870 films, 6,200 locations, every one photographed, every film with a
year. 657 works created and 5,783 submissions across 1,474 works.

**1,590 of 1,870 films matched, 85%, against ReelStreets' 7.5% on its first
run.** The matcher is the same one, unchanged. What changed is the catalogue: it
had already grown past 7,000 works, so a new source finally has something to
attach to. Worth remembering when judging the next source by its match rate.

**Three defects, none of which announced itself.** 519 of 1,870 records — 28% —
arrived as mojibake because the site declares UTF-8 in a `<meta>` tag and sends
no charset header, so `requests` follows RFC 2616 and assumes ISO-8859-1. "Léon"
was on its way into the catalogue as "LÃ©on", and the cache held the mis-decoded
text too, so it had to be dropped and the site re-harvested. The crawler now
trusts the header when it says something and the document when it does not,
which is right for every site rather than this one.

The other two were caught by their own output. A bracketed alternative title —
"Harry Potter And The Philosopher's Stone (…Sorcerer's Stone)" — did not match
the work we already hold and was proposed for creation, which is exactly the
duplicate the works ingest is written timidly to avoid. And the ingest died on
"ON CONFLICT DO UPDATE command cannot affect row a second time" because this
site lists "Transformers: The Last Knight" twice, both entries matched one work,
and `(work_id, place_key)` is a global key while the dedup was per film. The
ReelStreets ingest carried the same latent bug and was fixed with it; it had
simply not met a collision yet.

**A concurrent session added a sixth kind while this landed.** `open_plaques`
rewrote the same evidence constraint. Verified against the live database before
shipping: all six kinds appear in both the enum and the constraint, so neither
session's branch was lost.

**Updated**: `wiki/concepts/movielocations-source.md` (new), `wiki/index.md`,
`test/movielocations-source.test.mjs`

## [2026-08-06] ingest | ReelStreets: prose a model had to read, and a 20/min ceiling

**Object**: `tools/scraperai/{reelstreets,extract_places,state}.py`,
`app/lib/reelstreets-source.mjs`, `scripts/ingest-reelstreets{,-works}.mjs`,
`supabase/migrations/20260806143719|143733`
**Scenario**: ingest · **Outcome**: ⚠️ partial — 465 of 3,536 films extracted so far
**Code changes**: this commit

**A fourth source, and the first whose addresses are sentences.** ReelStreets
gives 3,536 films and 95,258 captures with no IMDb id and no coordinate; only
1.5% of captions end in anything postcode-shaped, and one of the samples is a
studio set rather than a place. So a model reads the place out of each caption —
once per film, batching ~25, so 3,536 calls rather than 95,258 — and names it
only. The geocoding cascade locates, separately. What ReelStreets has that
nothing else does is 53,126 photographs of the place as it is today.

**Three failures worth writing down, all of which only appear at scale.** An
early prompt asked for a `kind` field beside the place; on films with 40+
captions the free model silently stopped emitting it and every real place was
recorded as unknown — 0% real, and it looked like a working run. Removing the
redundancy rather than working around it took it to 89%. Malformed JSON
reproduced byte for byte on retry at temperature 0, so batches now **split**
instead of repeat. And `Connection error` was landing in the "model could not
serialise this" branch, discarding 110 captions across 8 films before anyone
noticed; transient errors now back off and retry.

**The 20/min ceiling is per account, not per model.** OpenRouter's
`free-models-per-min` is a shared bucket, so switching to another free model —
including the cheap Chinese ones — changes nothing. Paid options were measured
rather than chosen off the price list: `ling-2.6-flash` is twenty times cheaper
than `qwen3.7-flash` and matches its recall, but drops the postcode, which is the
difference between an address a geocoder resolves and a street name repeated
across a city. The free model keeps it, so free won on quality as well as cost —
at 4 films a minute, 14 hours.

**Incremental collection, per Nikita 2026-08-06.** Both sites expose the right
signal — MovieMaps dates every sitemap entry, ReelStreets' API takes
`modified_after` — but timestamps lie in both directions, so `state.py` also
fingerprints what was extracted. The ReelStreets fingerprint covers the captions
alone, so a film that merely gained a photograph is not re-read by the model.
That is where it pays: a full pass is 14 hours, forty changed captions is
seconds.

Result: 354 works created, 8,063 submissions across 380 works, all `pending`,
every one with imagery. The works ingest creates only where no work with that
title exists, because with no external id there is no unique index to lean on —
verified after the fact that none of the catalogue's 159 duplicate
`(title_norm, year)` groups involves a row it created.

**Updated**: `wiki/concepts/reelstreets-source.md` (new), `wiki/index.md`,
`.gitignore`, `test/reelstreets-source.test.mjs`, `scripts/set-openrouter-key.sh`

## [2026-08-05] ingest | MovieMaps: 18k geocoded places, and a licence nobody wrote

**Object**: `tools/scraperai/`, `app/lib/moviemaps-source.mjs`,
`scripts/ingest-moviemaps.mjs`, `scripts/ingest-moviemaps-works.mjs`,
`scripts/check-service-key.mjs`, `supabase/migrations/20260805003943|003954|120555`
**Scenario**: ingest · **Outcome**: ✅ success
**Code changes**: `d1d9077`, `b5720e6`, `9f8540b`, `cbffe3f`

**The coordinates were never in the HTML.** MovieMaps draws its map client-side, so a
parser reading the rendered page gets names and no points. Every detail page ends with
the call the site makes to its own JavaScript — `moviemaps.loadPublic('MovieDetail', …)`
— carrying coordinates, city, country, Street View camera pose and the fictional name
each place plays. One movie page geocodes an entire film. Reading that instead of the
markup is the difference between a gazetteer with invisible holes and 18,048 locations
where **every single one** has both a coordinate and a street address. Full harvest:
24,089 pages, 0 errors, 102 minutes, 90,764 frames.

**The site publishes no licence at all** — /about, /terms, /legal and /copyright all 404.
So every row carries `source_license = 'unstated'`: not a guess at a permissive one, and
not the `CC BY-SA 4.0` default removed when [[film-permits]] landed, for exactly this
reason. A MovieMaps row is a lead, not licensed content. Its 90,738 frame links are
stored for the **reviewer** and never enter `work_images` — that is the Film-Grab
refusal in [[moviemaps-source]]'s sibling page applied, not waived: a permissive footer
grants nothing when the copyright is the studio's, and here there is not even a footer.

**A CASE with no ELSE let a whole source owe no evidence.** Adding `moviemaps` to
`submission_source_kind` opened a hole in the provenance rule written one migration
earlier: the evidence CHECK is a CASE over `source_kind` with no ELSE, a CASE that
matches nothing returns NULL, and a CHECK treats NULL as **passed**. Every moviemaps row
would have satisfied the rule by not being named in it. It now ends in `else false`.

Two more worth keeping. **A check that ran a select proved nothing** — `works` is
publicly readable, so the anon key passed the "can this key write" test; it now probes a
write and reads the JWT's own role claim. And **`works.source` had to exist before the
import**, because the catalogue was 15 deliberate rows and became 6,044; without the
column nobody could later tell a curated work from a scraped one.

Result: 6,029 works (5,380 films, 649 series) and 30,170 submissions, all `pending`,
reconciling exactly with the harvest — 30,386 links less 216 duplicate place keys. The 15
curated rows kept their `wikidata_id` and `tmdb_id`; the works ingest inserts and never
updates.

**Updated**: `wiki/concepts/moviemaps-source.md` (new), `wiki/index.md`,
`wiki/sources/source-evaluation.md`, `.gitignore`, `test/moviemaps-source.test.mjs`
## [2026-08-08] incident | The names were not the problem, and the first diagnosis said they were

**Object**: `app/lib/place-name-head.mjs`, `scripts/geocode-submissions.mjs`,
`app/lib/submission-review.mjs`, `wiki/concepts/queue-review.md`
**Scenario**: bug · **Outcome**: ✅ corrected

Earlier today this log said 13,841 rows had no coordinate because their `place_name` was a
caption — 47% of movie-locations names past twelve words, 54% carrying the `<Film>
location:` prefix the extractor was meant to cut. **Re-measured before starting the
repair: 71 of 5,580 and zero.** Another branch fixed its extractor and re-ingested the
source in the hours between. The repair being asked for had already happened.

What the first measurement never checked is one column:

```
moviemaps      geocode_source = moviemaps        30,147
open_plaques   geocode_source = open_plaques         53
permit_record  geocode_source = opendata_paris       10
reelstreets    geocode_source = reelstreets          27
reelstreets    geocode_source = NULL               8,035
movielocations geocode_source = NULL               5,580
```

**No geocoder has ever been run on this queue.** Every located row got its point from the
source it was scraped from. The 13,637 pointless rows were never blocked by their names.

**And the 508 long ReelStreets names are not captions either.** They are written
descriptions of where a camera stood — *"Bristol Temple Meads station on Station Approach
off Bath Road in Bristol, Avon"* — precise, deliberate, and unanswerable by a gazetteer.
A different problem with a different fix.

So the work became: turn a written location into something a gazetteer can answer.
Measured on 120 rows —

| asked | resolves |
|---|---|
| the name as stored | 0.8% |
| the first comma clause alone | **31.7%** |
| head + area, kept only if the head landed inside the area | **8.3%** |

**The middle number is the trap.** Dropping the comma clause throws away the
disambiguator, and the 31.7% includes Zorba (a restaurant on Leinster Gardens) in
Colorado, St John's Square in Malta, the Federal Reserve Bank in Dallas and the Union
League Club of Chicago in New York. `chooseCandidate` cannot catch these: it reports
`unique` for a lone result wherever on earth it is, because its job is choosing between
candidates, not checking one against the world.

So the clause becomes the **area**, resolved separately, and the head is kept only if it
landed within the same 100 km the geocoder already uses for a hint. Trying areas
**most-specific-first** doubled the yield on its own (3.3% → 8.3%): a country centroid
confirms nothing at a hundred kilometres, and anchoring "Kladruby Monastery, Kladruby,
Czech Republic" to the country rejects a correct row that the village next door confirms.

Two refusals earned their place the same way: `head_is_a_common_noun` ("the alley at the
corner of…" reduces to "alley", which Wikidata places in Israel) and
`road_is_a_line_not_a_point` ("A82 at Rannoch Moor…" reduces to "A82", whose point is the
road's southern end in Glasgow — 80 km away, on the right road and in the wrong place).

**The lesson for the handoff:** a measurement of a shared production table is a snapshot,
not a fact. Two numbers in this log were already stale when they were written, and both
were stale because another branch was working the same rows.

## [2026-08-08] decision | The queue got its first verdicts, and the count that mattered was not 30,257

**Object**: `app/lib/submission-review.mjs`, `scripts/review-submissions.mjs`,
`app/api/locations/route.js`, `app/lib/submission-places.mjs`
**Scenario**: feature · **Outcome**: ✅ success

"30,257 rows, zero reviewed" reads as a clicking problem. Measured before writing
anything, it is not one, and three numbers say why.

**The 30,257 geolocated rows are 30,153 MovieMaps rows and 104 others.** Their names are
clean — 22 characters on average, two rows over twelve words in the whole set — and their
coordinates are one per place: **3,187 of 3,313 name-clusters hold exactly ONE distinct
point**. So the obvious offline check, "do the rows agree with each other", proves
nothing; they are the same number copied, not independent observations. Everything that
would actually settle such a row needs the network.

**13,841 rows have no coordinate, and mostly cannot get one, because the name is a
caption.** 47% of movie-locations names run past twelve words and 54% still carry the
`<Film> location:` prefix the extractor was meant to cut — which is why **zero** of its
5,783 rows are geocoded, and reelstreets has 27 of 8,063. That is our extraction failing,
not the source lying, and the review says so per row instead of burying it.

**So a human queue of 30,257 rows is not a product** — the reviewer would hold no more
information than we do. What shipped is the verdict itself: mechanical refusals, a
source-class rule for claims a stranger can already check, and the weighted path for the
signals the resolver in another branch is producing.

**Applied to production: 90 verified, 914 rejected.** 53 plaques (the sentence is
engraved on a wall at the coordinate — nothing else in the corpus is checkable that
cheaply), 10 filming permits (the city that issued it is the authority), 27 rows carrying
both a resolved Q-id and a statement. Rejected: 161 rows named "Google Maps" and kin —
the caption of a map link — and 753 whose name is a photo credit, "Wikimedia /
Alexanderm14".

**Two rules were wrong first, and the live data said so both times.**

`wikidata_entity` is a CLAIM signal in `place-review.mjs` and that is right there and
wrong here. For a place discovered from a work's Wikidata statement, the entity IS the
claim. For a queue row the Q-id is found the other way round — by asking what sits at the
coordinate the scraper gave — so it proves the BUILDING exists and says nothing about
whether a film was shot in it. It also scores 0.6, exactly the threshold, so without the
correction 29 rows would have published "filmed here" on the strength of "this address is
real".

And `cited_source` first demanded that the sentence name the place it was filed under.
Checked against real rows it was wrong in both directions: *"Bridge used in the first
episode of series 1"* PASSED for Vauxhall Bridge on the word "bridge", while *"Jim wakes
up from a coma in an abandoned hospital"* FAILED for Central Middlesex Hospital, which is
a real statement about a real row. Prose does not repeat its own heading. What is worth
excluding is the row that states nothing at all — `Source: Wikipedia`, `Source: IMDb` —
and that is what it does now.

**A verified row would have vanished off the map.** `/api/locations` filtered
`status = 'pending'`, so believing a submission deleted it. Now it filters *not rejected*,
and a checked row reads "Source checked" with the reason instead of "not yet verified by
us". It is still a candidate and still outside the graph, and the card says both.

**Only the decisive verdicts are stored.** A pending row's reason — no signal yet, no
coordinate, the name is a caption — is derived and goes stale the moment a Q-id lands or
the extractor is fixed. Writing 42,884 of those would stamp `reviewed_at` on rows nobody
decided anything about, and the queue would report itself as reviewed when all that
happened was a label. One script run re-derives them.

**Reversible in one statement**, and the script prints the full breakdown every run.

## [2026-08-08] incident | Another session is live in the same production database

**Object**: `location_submissions`
**Scenario**: chore · **Outcome**: ⚠️ carried forward

Found while measuring the queue: the worktree `skype-ai-openrouter-movie-maps-bffab0`
applied `submission_resolution_and_corroboration` to production at 21:34 — ten minutes
after this session's own migration — and is running a Wikidata resolver against the queue
right now. Its columns `wikidata_id` and `corroborated_by` exist in the live database and
in **no file**; the count of resolved rows went 0 → 20 → 34 across three measurements
forty minutes apart, and the table lost 210 rows to its deduplication in the same window.

**That migration is deliberately NOT captured into `supabase/migrations/` here**, unlike
the thirteen captured earlier today: it belongs to a branch that has not merged, and
committing it from this side would collide with its own PR. It is drift with a known
owner, which is a different thing from drift with none.

Practical consequence for anyone measuring the queue: **quote the time.** Numbers in this
log entry and in `submission-review.mjs` are as of 08.08 and were already moving as they
were written.

## [2026-08-08] incident | The graph could not be written to, and had not been since 31 July

**Object**: `app/api/resolve/route.js`, `supabase/migrations/20260808010100_*`
**Scenario**: bug · **Outcome**: ✅ fixed · #129

Found while working #129 on paper, not while looking for it.

`20260731234121_scene_links_allow_revisits` replaced `unique (work_id, place_id,
relation_kind)` with two **partial** unique indexes so a story could revisit a place
across scenes. The reasoning in that migration is careful and right about NULLs on
Postgres 14. It missed that PostgREST sends `ON CONFLICT (work_id, place_id,
relation_kind)` with **no WHERE clause**, and Postgres cannot infer a partial index from a
bare inference clause. Probed against production:

```
ERROR 42P10: there is no unique or exclusion constraint matching the ON CONFLICT
specification
```

`/api/resolve` is the only write path into the canonical graph. It has been failing on
that upsert for eight days — *after* the Wikidata round-trips succeed, so the route looks
like it is working. The graph has stood at **92 links and 70 places** the whole time while
the review queue grew to 44,098 rows, and nothing reported it.

**Fixed by a FULL index with `nulls not distinct`** — Postgres 15 gained it, this database
is 17.6. Inference works again and the guarantee the split protected is intact: two
scene-less rows for the same triple still collide, because their NULLs no longer compare
as distinct. Verified by probing the real database inside a rolled-back transaction.

**The lesson, and it is the second time this project has paid for it:** a schema change
that is correct in SQL can still break the client that talks to it. `on_conflict` is a
promise about an index shape, and nothing in the database tells you who relies on it.

## [2026-08-08] decision | A fact has its own identity, its own payload and its own sentence

**Object**: `supabase/migrations/20260808010000_*`, `20260808010100_*`,
`app/lib/facts.mjs`, `app/lib/work-profile.mjs`, `app/api/work/route.js`
**Scenario**: feature · **Outcome**: ✅ success · #129 · [[fact-architecture]]

Step 1 of #129 asked for the schema to be worked through **on paper** first, against real
examples. Ten were written out and six of them could not be expressed —
[[fact-architecture]] holds the table. They cluster: every one appears the moment a source
states **a specific claim, with a date, in a sentence**, which is exactly what plaques
(#125) and music (#128) are.

**Break 1 — one row per (work, place, kind).** Abbey Road plus The Beatles plus "recorded
here" was one row for twelve recordings. A fact now carries `about` (which album, which
episode, which scene) and `about` is part of the uniqueness key, so two facts of the same
kind at one place are legal when they are about different things and still illegal when
they are not. Proved on the live database, rolled back: three facts of the same kind at
one place, told apart by `about`.

**Break 2 — a fact about a person pinned to a work.** Rowling's café was seven rows, one
per book, with the evidence copied seven times, and the eighth book would have made it
eight. `creator_place_links` now exists with the same evidence contract the work facts got
on 05.08: no source, no fact, checked at commit. It reaches a work through
`work_creators`, and `work_facts()` uses `exists` rather than a join so a person who both
wrote and directed does not contribute every fact twice. Proved live: two roles, one fact
on the card.

**And the sentence.** `placeRole()` builds the card's phrase from the relation kind, which
was the only option while a fact was a bare Wikidata triple. A plaque hands over the whole
sentence already written on the wall, and turning *"J. K. Rowling wrote some of the early
chapters of Harry Potter in the rooms on the first floor of this building"* into "Where the
author worked" throws away the part somebody crossed a city to read. Stored wording is now
printed **verbatim** — trimmed and nothing else, because a quote that has been tidied
cannot be checked against the wall it came from.

**Degree of separation, computed once in SQL.** 0 the work itself, 1 its people, 2 what
influenced it. 0 and 1 may enter a route; 2 is "nearby, and here is why". Without it,
"Harry Potter places" becomes "places connected to anything Rowling ever touched" without
anybody deciding to make it so.

**Not done, deliberately:** `work_place_links` was NOT renamed — eight stored functions
reference it by name and function bodies do not follow `ALTER TABLE RENAME`, so a rename
would silently break every map RPC on the demo path. And #129's single polymorphic fact
table was not built: two typed tables keep the foreign keys, and the `place_facts` view
gives the one read surface the proposal was really after.

Wired, not shelved: `/api/work` now answers from `work_facts()` in one call. 874 tests.

## [2026-08-08] update | Thirteen migrations existed in production and in no file

**Object**: `supabase/migrations/` (13 new files)
**Scenario**: chore · **Outcome**: ✅ success

The handoff warns that "the database has rules the repo does not describe". Measured:
`supabase_migrations.schema_migrations` held **13 migrations with no file** —
`map_points_rpc_geometry_bbox`, `map_works_with_poster`, `map_works_with_ratings`,
`works_mc_path`, `tts_cache_bucket`, `place_frames`, `scene_links_allow_revisits`,
`scene_stop_precision`, `works_source`, and the reelstreets and movielocations pairs.

All 13 are now files, verbatim, under their live version numbers with a header saying
where they came from. One of them turned out to contain the outage above, which is the
argument for doing this at all: a rule you cannot read is a rule you cannot check.

`scenemap_initial_schema` (14th) was deliberately **not** captured — its tables are
dropped by `content_graph`, so the file would recreate dead history, and its comments are
in Russian, which the repo does not allow.

## [2026-08-07] decision | Handoff rewritten to the state that actually exists

**Object**: `wiki/handoff.md`, `wiki/sources/commemorative-plaques.md`
**Scenario**: chore · **Outcome**: ✅ success

The handoff a session leaves behind is read by someone with no memory of it, so it is
worth only as much as its worst wrong number. Three were wrong and are corrected.

**"811 titles we do not hold" was never a measurement.** It came from a Title Case sweep
that also produced "The Hospital" and "Junior High School". The honest figure is **49
candidates, 13 resolvable** — and the difference matters because 811 makes plaques look
like the next volume lever when they are not. The page said it, the source page said it,
and both now say what was measured.

**The next volume lever is the person path, and it is blocked on an empty table.** 2,952
plaques name 1,479 creative people with Wikipedia links; reaching their works needs
`creators` / `work_creators`, which hold nothing. That is a SOURCE problem, not a rules
problem, and calling it correctly is what stops the next session from tuning a matcher
that is already right.

**The queue is the largest unfinished thing in the project**: 30,257 geolocated rows
across 6,075 works, **zero reviewed**. Showing them as clearly-labelled candidates was
this session's fix and it buys time; it is not a decision per row, and the handoff now
says so in those words.

Also recorded where it will be found: a merge into `main` does not reliably deploy
production and `commits/<sha>/status` goes green on the Preview check; constraints exist
in the live database that no migration in git describes; and the Open Plaques dump ships
its own Null Island.

## [2026-08-05] ingest | Titles on plaques became works, and the rules that made them true

**Object**: `app/lib/plaque-title-resolve.mjs`
**Scenario**: feature · **Outcome**: ✅ success · #125

The plaque ingest could only link to works we already held, and that was the ceiling: of
853 titles named on plaques stating production, **811 were works we did not have**. This
resolves the title in Wikidata and creates the work carrying its q-id from birth.

**The extractor first.** A crude Title Case sweep produced those 811, and they include
"The Hospital", "Junior High School" and "Town & Country". Tightened to quoted strings
and titles introduced by their kind ("the classic film X"), the same 140 plaques yield
**49 candidates** — a number small enough to be checked by eye, which is the point.

**Then three rules, and each was added because the previous version was wrong in a way
that looked right:**

| rule | resolved | wrong among them |
|---|---|---|
| exact title + is a film/series/book | 27 | 7 |
| + the year written on the wall | 18 | ~4 |
| + the title beside the claim | **13** | **0** |

The instructive failures: **"The Lady Vanishes"** resolved to the 1976 remake although
the plaque is about Gainsborough Studios **1924-1949**; **"Taj Mahal"** to a 1963 film
although the plaque names a hangar in San Antonio; **"Decoration Day"** to a 1990 film
although the plaque is about a cemetery tradition. Two years on a plaque are a RANGE, not
two points — that is how The Wicked Lady (1945) was being rejected while the 1983 remake
was not. And with no year at all, a match is only safe when exactly one work carries the
title, because there is nothing to disambiguate with.

**The verb chooses the kind.** "Zane Grey, the prolific author of western novels, lived
here … Riders of the Purple Sage" is about the NOVEL; the 1918 adaptation would have the
author writing a film he never made.

**Written to the database, and the upsert matters as much as the insert.** Five of the
thirteen already existed here under an IMDb id or a unique title, so they were ENRICHED
with their Wikidata id rather than duplicated; eight are new. Works carrying a Wikidata
id went from **15 to 28**. A title matching two of our rows is left alone — guessing
which is the 1945 film is the mistake the year rule exists to prevent.

**Live:** 53 plaque rows across 40 works. The new ones answer on production — The Wicker
Man at Whithorn Library, You Only Live Twice at the Duck Inn where Fleming wrote it,
Dial M For Murder at Ifield Green, Finnegans Wake at Bognor Regis, Crime and Punishment
at Dostoevsky's flat on Kaznacheiskaya.

## [2026-08-05] ingest | Plaques on the map: 43 places where the quote is on the wall

**Object**: `app/lib/plaque-source.mjs`, `scripts/ingest-plaques.mjs`,
`supabase/migrations/20260807020000_*`, `20260807020100_*`
**Scenario**: feature · **Outcome**: ✅ success · #125, PR #138

Coverage work, and the honest headline is that **plaques raise quality, not volume**.
47,064 plaques carry a coordinate; after the rules, 50 of them state something about a
work we hold, and 43 rows survived deduplication into the live queue across 31 works.

**The rules ARE the feature, and each was measured on the whole world dump:**

| rule | hits |
|---|---|
| normalised substring | 4,643 — "the club", "the beach", "the office" |
| + case-sensitive on the original text | 346 |
| + the claim word within sixty characters | **46, and they are real** |

Without the last one a pub called The Crown is the series The Crown, and a
cinematographer's credit list ("Among his film credits are Oklahoma, Doctor Dolittle,
The Graduate") becomes four filming locations nobody claimed.

**Refused before anything else:** 6,269 Stolpersteine and kindred memorials, 1,413 of
them inside the phrase "lived here" — the phrase a naive filter keeps.

**Three faults in the data itself**, each now a guard with a test. The dump carries
**Null Island**: the Majestic Cinema in Leeds arrives as `latitude 0.0` with a correct
longitude, and `finiteOrNull` cannot catch it because 0 is finite and a legal latitude.
Some rows name the place `?`. And `organisations` is a JSON array written as text, which
rendered as "Plaque erected by []".

**Stored: the claim SENTENCE, not the wall.** The One Tun's inscription runs to nine
hundred characters about saffron crops with the Oliver Twist claim in the first line —
the same rule the Wikipedia extractor already follows, for the same reason.

**Live now:** Midsomer Murders gained five pubs, Groundhog Day three Woodstock landmarks,
plus Brief Encounter at Carnforth Station, The Railway Children at Oakworth, The Wicker
Man, A Clockwork Orange, Billy Liar, Gainsborough Studios, Local Hero at the Pennan Inn,
Moby Dick at Youghal.

**Two paths measured and NOT taken**, so nobody re-measures them. Matching a person's
plaque to their works through Wikidata gives 1,547 works for the 25 most-plaqued people
and only **11 of ours** once the kind has to agree — Dickens wrote the NOVEL Oliver Twist
and our row is the film. And the ceiling is not the matcher: of 853 titles named on
plaques that state production, **811 are works we do not hold**. The lever for volume is
creating those works from an identifier, not widening this filter.

**Drift again:** the live evidence CHECK already carried `reelstreets` and
`movielocations` branches that exist in no committed migration. Rewriting the constraint
from what the repo knew was rejected by 8,063 rows — a constraint is written against the
database that exists.

## [2026-08-05] update | Coverage measured, and the map stopped hiding what we already know

**Object**: `app/api/locations/route.js`
**Scenario**: bugfix · **Outcome**: ✅ success
**Code changes**: `#136`

The owner asked how many works have fewer than five places. The answer led straight to a
bug that was hiding a third of the base.

**The queue, exactly.** 6,394 works have rows; **78.7% have fewer than five geolocated
places**, the median is 2 and the mean 4.7. The distribution is a long thin tail: 5.3%
have none, **39.8% have exactly one**, 17.1% have two, 16.5% three or four, and only 8.3%
have ten or more. Split by kind: films 82.5% under five (median 2), series 45.5% (median
5, and one series holds 961).

**But the map answers from three sources**, so the queue's number is not what a person
sees. Measured end to end on production, fourteen works drawn at random from the thin
buckets: live sources ADDED places to ten of the fourteen — Altered States went from 3 to
16, The Invisible Man from 1 to 6.

**And four of the fourteen returned nothing at all**, although we hold their places. The
queue was only ever consulted after Wikidata had identified the work, so when Wikidata
does not know the title — "The Drive of Life" is not there under that name, "Wild West
Tech" is a television documentary our records call a film and the type check refuses
every candidate — the product stayed silent about places it already had. The same failure
this session keeps finding: work that never reaches the live path.

Both empty paths now ask our own records first, matched on title and kind, labelled
"matched by title" on every card, with `matched_work` saying "from our own records — not
identified in Wikidata".

**After: 0 empty of 14** (was 4), and the juror scenario is 0 empty of 24 with a median
of 1.26s.

**Deployment lesson, and it cost the verification.** See [[deployment-pipeline]]: of four
merges into `main` in forty minutes only two produced a Production deployment, and
`gh api commits/<sha>/status` goes green on the PREVIEW check. Production was serving an
hour-old commit while the poll said success. Ask for the environment by name, and use
`gh workflow run "Deploy production"` when it has not fired.

## [2026-08-05] rule-change | English everywhere, including GitHub

**Object**: `AGENTS.md`, `wiki/log.md`, four issues and seven pull requests
**Scenario**: decision · **Outcome**: ✅ success

Owner's instruction (05.08): **the project is in English — the repository AND GitHub.**
This replaces the earlier convention recorded in the handoff, "repo in English, GitHub
issues in Russian", which was followed for issues #125, #127, #128, #129 and for the
titles and bodies of PRs #122, #123, #126, #130–#133. All of them are rewritten.

Five log entries written earlier today in Russian are translated here as well, along
with `wiki/index.md` and the correction note in `wiki/sources/source-evaluation.md`.

**What stays in Cyrillic, deliberately.** It is data, not prose:
`wikipedia-source.mjs` holds the Russian section names the extractor queries
("работа над картиной", "съёмки" …) — removing them removes a language edition; and
`place-dedup.mjs`, `place-precision.md` and two tests use "Красная площадь" as the
example that proves the name normaliser keeps non-Latin alphabets instead of emptying
them. Both would be broken by translation, not improved.

**Merge commit subjects on `main` are still Russian** — seven of them, from today. They
are rewritable only by rewriting the branch's history, which is destructive and is the
owner's call.

## [2026-08-05] decision | The queue reached the map, and the owner ruled on MovieMaps

**Object**: `app/lib/submission-places.mjs`, `app/api/locations/route.js`
**Scenario**: feature · **Outcome**: ✅ success
**Code changes**: `#132`

The owner set the bar: the prototype must be FULLY working — not a demo on fifty films,
but the whole base we collected. Measuring the gap showed how far off that was.

**The measurement.** The database holds **38,270 submissions, every one `pending`, 30,212
with a coordinate, across 6,054 works** — and **no route in `app/` reads
`location_submissions`**. The live map answered from Wikidata alone, so a title search
found places for **15** works while the ingest had facts for six thousand. Everything
previous sessions pulled in was sitting in the dark.

**The bridge is the IMDb id.** A work matched in Wikidata carries P345; the ingested works
carry `imdb_id` — 6,041 of them, covering 30,189 geolocated rows. Wikidata q-ids cannot do
it: only 15 of our works have one.

**They arrive as candidates.** Hollow pin, "not yet verified by us", link to the source —
the same treatment the inverted search got the same day. They never enter `places` or the
graph. Bounded: nearest to the viewport first, twelve per work (Person of Interest alone
has 961 rows), deduplicated against both earlier searches.

**On production:** Notting Hill 10→15, The Dark Knight 14→26, Inception 20→34, Sense8
2→14, Harry Potter 17→26. Parasite, which has no P915 at all in Wikidata, got a real
Seoul street from the queue.

**The owner's decision on MovieMaps.** The session that ingested those 30,161 rows wrote
in its own research: "A MovieMaps row is a lead: strong enough to put in front of a
reviewer, not licensed". Showing publicly is a different act from storing, so it was
asked rather than assumed. The decision: **show them as unverified candidates.**

The grounds, all measured: moviemaps.org has **no terms page at all** — `/terms`,
`/legal` and `/copyright` are 404, so no prohibition exists to honour (which is what
separates it from reelstreets, whose terms exist and forbid); we take **facts** — a place
name and a coordinate — not their prose or their images; every row is labelled unverified
and links back; the project is not commercial.


## [2026-08-05] update | The juror scenario: 24 favourite films, three empty maps, zero after the fix

**Object**: `app/lib/location-search.mjs`, `app/api/locations/route.js`
**Scenario**: bugfix · **Outcome**: ✅ success

The owner stated the demo's acceptance in one sentence: **someone on the jury names their
favourite film, we type it in, and it is there — with no doubt that we have it.** Measured
on production before touching anything, 24 well-known titles: **three came back empty** —
Parasite, Spirited Away, Skyfall. The causes were different and both were worth fixing.

**First: the wrong entity wins.** `wbsearchentities` ranks by label match and nothing
else. "Skyfall" returns Adele's song, her lyric video and the soundtrack — **the film is
not in the top eight at all**; "Parasite" returns a parasitology journal, two video games
and the biological concept. The type check does not save it: a music video IS a film in
Wikidata's hierarchy, so the lyric video passes and answers with nothing.

What separates them is fame — sitelink counts: Skyfall film 78 against song 36 and video
2; Parasite film 81 against the concept 46; Spirited Away film 109. The candidate list is
now 15 deep and ordered by `wikibase:sitelinks` before the type check. **Type still has
the last word** — a famous song can lead the list and still be refused for not being a
film. This also closes the handoff's long-standing "Skyfall resolves to Adele's lyric
video": 0 places before, 20 after, 13 of them in London.

**Second: the work genuinely has no places.** Spirited Away and Parasite carry no P915 at
all — one is animation, the other built its sets. An empty map does not read as "nobody
recorded the locations", it reads as "we do not have that film", which is the one
impression this product cannot afford. There is now a ladder: narrative location (P840),
then country of origin (P495), each rung saying what it is — "Parasite is set in South
Korea. No exact filming locations are recorded for it yet". A country renders as an area,
never a doorway.

**After: empty for 0 of 24.** 824 tests green.


## [2026-08-05] rule-change | Not a commercial project — which changes some refusals and not others

**Object**: `wiki/sources/source-evaluation.md`, issue #127
**Scenario**: decision · **Outcome**: ✅ success

The owner clarified (05.08): **this is a student demo and it is not sold.** The goal is to
show a jury what can be built with AI, not to reach a market. So the note "SuperPoint and
SuperGlue are refused over their non-commercial licence" was written under a wrong premise
and is withdrawn.

**What that changes.** Restrictions of LICENCE TYPE — CC BY-NC, non-commercial model
weights — stop being blockers while nothing is sold: SuperPoint/SuperGlue, MusicBrainz
supplementary data (CC BY-NC-SA), non-commercial Fandom wikis. Their conditions are
honoured as written — attribution, share-alike — and the whole thing is revisited the
moment selling is discussed.

**What it does NOT change, and the difference is the point.** A prohibition in terms of
use forbids the ACT, not the earnings: scraping IMDb, MovieMaps or Reelstreets stays
forbidden whether or not money changes hands. And "the source has no rights to grant"
(Film-Grab and similar frame corpora) stays too: non-commercial use of somebody else's
work without rights is still use without rights.

The rule in one line: **a licence says on what terms you may; a site's terms say whether
you may at all.** The first depends on commerce, the second does not.

The practical gain is modest — ALIKED + LightGlue under Apache/BSD already cover what
SuperPoint/SuperGlue do. The real gain is elsewhere: Fandom's stop lists open up as DATA
rather than only as a recall benchmark.


## [2026-08-05] decision | Four directions the owner set: photo verification, music, facts, plaques

**Object**: issues #125, #127, #128, #129
**Scenario**: research · **Outcome**: ✅ success — researched and recorded, no code started

Everything below was measured with live queries and licences read at the source.

**#127 — verifying a place from photographs.** The headline: ready technology covers
exactly half. Locating a photograph is solved and free — **MegaLoc** (MIT, CVPR 2025),
**LightGlue** (Apache-2.0) + **ALIKED** (BSD-3), hloc, StreetCLIP. The other half is
solved nowhere and is our product: those systems answer "where was this shot" with a
probability, while our question is "is it true that film X was shot at address Y, and what
proves it". The difference is practical: we hold a hypothesis (far cheaper than searching
the planet), we need a **countable number of matched points** rather than a model's
opinion, and we are **allowed to answer "we don't know"**. Half the pipeline is already
written: `scene-frame-match`, `still-classify`, `mapillary` (with `compass_angle`),
`building-snap`, `place-review`, `grounding`, `isMatchablePlace`.

**#128 — music as a kind of work.** The owner decided we take it. Measured: Wikidata's
`P483 recorded at` gives **5,464 recordings whose studio has a coordinate** (every early
Beatles track → Abbey Road), music videos with `P915` number 111, UK plaques with a
musical subject 1,248. MusicBrainz: core data CC0, supplementary CC BY-NC-SA. Personal
library: **Last.fm reads a listening history from a nickname with no user auth**
([[personal-collections-matrix]]); Spotify allows five test users in dev mode; Apple Music
wants $99.

**#129 — the architecture of facts, and this is the important one.** The schema expresses
half of what the product needs, and both breaks are visible without code. First:
`unique (work_id, place_id, relation_kind)` **forbids a second fact of the same kind** —
Abbey Road and The Beatles is one row for twelve recordings. Second: a fact about a person
is pinned to a work — Rowling's café is seven rows with the same evidence copied seven
times, because `creator_place_links` does not exist. Proposed: one fact table with two
kinds of subject, so the work card and the place card become one query read from
different ends. Plus a **degree of separation** (0 about the work, 1 about its person, 2
about what influenced it) visible in the interface — without it, "Harry Potter places"
quietly becomes "places connected to anything Rowling ever touched".

**Updated**: `wiki/sources/commemorative-plaques.md` (#125 recorded separately)


## [2026-08-05] ingest | Plaques on facades: the quote is already written on the wall

**Object**: `wiki/sources/commemorative-plaques.md`, issue #125
**Scenario**: research · **Outcome**: ✅ success

The owner's observation: the round plaques in London and Edinburgh say "filmed here",
"recorded here", "written here". Checked with live queries — the source exists and it is
better than anything before it.

**Open Plaques, licensed PDDL — public domain.** Stronger than the ODbL and CC BY-SA this
project already relies on. Dumps in CSV/JSON/GeoJSON; they ask people not to crawl.
55,115 plaques, **47,064 with a coordinate**; the UK holds 17,371 and every one carries
its inscription. A second, independent source is OSM (`memorial=plaque`): London 1,844,
Edinburgh 172, through the same Overpass that already backs `/api/access`.

**Why it fits perfectly:** the project's rule is a quote checked verbatim, and here the
quote IS the object — it is already in the `inscription` field. And it lands on "where it
was written or made": the Rowling plaque in Edinburgh, `My Beautiful Laundrette ... was
filmed on this road`, `Hunky Dory & Ziggy Stardust ... were recorded here`, Bowie in
Berlin. Plaques are also building precision at a street address — the rung Wikidata almost
never gives.

**Ours by subject role (UK):** film 538, music 1,248, books 1,802, 3,187 unique.

**Two refusals, both measured, both coded before anything else.** The dump contains
**6,269 Stolpersteine** and similar memorials to victims of Nazism, 1,413 of them inside
the phrase "lived here / wohnte" — they do not go into a walking tour, and they are
excluded explicitly and with a test. And a name is not an identifier: `Bowie` over the
world dump returns a hundred Texas markers about Jim Bowie and Bowie County.

**Open question for the owner:** music is a new kind of work. `work_kind` knows
film/series/book, musicians are the largest group of plaque subjects, and "this album was
recorded here" is neither a filming location nor a narrative one.


## [2026-08-05] decision | Shipped, and a merge turns out to be a release

**Object**: `wiki/entities/deployment-pipeline.md`
**Scenario**: deploy · **Outcome**: ✅ success

PR #122 merged into `main` (`ea91220`) and the three wired modules are live at
https://codex-hackathon-starter.vercel.app — verified on production, not on a preview:
"Harry Potter" from Edinburgh returns 18 places, 8 candidates including Greyfriars
Kirkyard, 15 pins and 3 areas; `/api/access` answers the V&A "open" with its hours and
Doune Castle "unknown".

**The wiki was wrong about what a merge does.** It said production was manual only,
behind a GitHub Actions workflow with a confirmation environment. Measured on this
merge: within seconds GitHub recorded a Vercel deployment in the environment
**`Production`**, and the production URL served a route that did not exist before the
merge. The Git integration is connected, `main` is a production branch, and anyone
merging a PR is shipping to users with nothing gating it.

Also recorded: the Vercel CLI on this machine is logged into a different account
(`nikita-8024`, team `kitpos`) than the one that owns this project
(`walklikeaman1904`), so `vercel ls --scope walklikeaman1904` answers "scope does not
exist" — which reads like a missing project and is a missing login.

## [2026-08-05] incident | Security advisor: what was ours, and what we cannot touch

**Object**: `supabase/migrations/20260805013939_security_advisor_findings.sql`
**Scenario**: security · **Outcome**: ⚠️ partial — 1 ERROR left open, cannot be fixed from our role

Two ERRORs and twenty warnings in the Supabase linter, which the owner was being
notified about. Sorted by whether a stranger with the anon key can do anything with
them, and fixed where the answer was yes.

**Fixed and verified live.** `links_without_evidence` ran with its OWNER's rights —
a view without `security_invoker` bypasses the caller's row-level rules, and nothing
about that view needs it. Ten functions had no fixed `search_path`, and `map_points_in_view`
and friends are called with the ANON key from the browser, so "whatever `places` the
session points at" is a real question. `search_path` is `public, extensions, pg_catalog` —
`extensions` is in the list against the day PostGIS is moved. Plus: the redundant
SELECT policy on `user_library_items` dropped (the FOR ALL policy already covered it),
`auth.uid()` wrapped in a subselect so it is evaluated once instead of per row, and the
three foreign keys that had no covering index.

Advisor after: security 2 ERROR + 19 WARN → **1 ERROR + 9 WARN**; performance 7 WARN → 0.
Verified as `anon` after the change: map_points 17, map_works 14, clusters 11,
remote_points 10, search_works 1 — and the same four routes answer 200 in production.

**What we cannot touch, and did not pretend to.** `spatial_ref_sys` is PostGIS's own
table, owned by `supabase_admin`. From `postgres` we cannot enable RLS on it, cannot
revoke another grantor's grants, and cannot `set role supabase_admin` — all three
attempted against the live database and verified afterwards to have changed nothing.
So the remaining ERROR is real in a specific way worth writing down: **`anon` can
DELETE from the SRID registry through PostgREST.** It is PostGIS reference data rather
than ours, and it is still writable by anybody holding the public key.

The one action that would clear it and the three `extension_in_public` warnings is
getting the extensions out of `public` — and PostGIS does not support `ALTER EXTENSION
… SET SCHEMA`, while dropping and recreating would take `places.centroid` (geography)
and `places.frame_embedding` (vector) with it. That is a database for a linter score.
Left for Supabase support, or for the next project to install extensions correctly.

**Drift found on the way.** Two migrations — `moviemaps_source_kind` and
`moviemaps_evidence` — were applied to the live database through the MCP by another
session and exist in NO branch of this repo. Recovered from
`supabase_migrations.schema_migrations` and committed, so a fresh environment is no
longer missing a CHECK constraint the production database enforces.

## [2026-08-05] update | Three finished modules reached the live path

**Object**: `app/lib/inverted-places.mjs`, `app/api/access/route.js`,
`app/api/locations/route.js`, `app/lib/place-search.mjs`, `app/lib/place-grade.mjs`,
`app/lib/place-access.mjs`, `app/lib/timed-tour.mjs`, `app/components/SceneMapApp.jsx`
**Scenario**: feature · **Outcome**: ✅ success
**Code changes**: `a7b8ba0`, `bbf4f7a`, `d962a03`

The handoff named the project's most repeated failure — finished, correct work that
never reaches the live path, now five times over — and listed three modules in that
state. All three are called now. 819 tests (was 788), production build clean, each
change verified in a browser.

**The inverted search finds Greyfriars.** Two ordering bugs, both invisible until it
ran. A work's title is usually also its main character's name, so "Harry Potter"
arrived twice and spent two of the six branches — pushing out Lord Voldemort, the ONE
name that graveyard's article contains. And Wikidata returns characters in no order,
so the budget went to the wrong ones in both directions: ranked now by class and by
sitelink count, DESCENDING for invented names (Voldemort was ninth of eleven) and
ASCENDING for real people, because George Washington is an Outlander character and his
273 sitelinks are about him. `wikibase:sitelinks` rather than a COUNT: 698ms vs 2,765ms.
Edinburgh, "Harry Potter": 4 places before, 18 after, 8 of them candidates.

**Nothing arrives as a claim.** A hit says only that a place's article mentions the
work — which is exactly what Thomas Riddell's grave is — so candidates get a hollow
pin, an "unverified" note and a link to the article. Turning one into a claim needs a
quoted sentence checked verbatim; that is still the next step.

**A route now says whether you can get in**, and the design was decided by measuring
first: of twelve stops from tours selling today, OSM knows about four, all in cities
(3 of 4 in London, 0 of 5 in rural Scotland). So `isRoutable` was applied where it
holds — closed is never routed to, confirmed beats unknown in the ranking — and an
unconfirmed stop is carried with its own sentence rather than deleted. Two ways to read
a neighbour's tags as this place's were found by running it: the nearest named feature
to Greyfriars is a gravestone 8 m away, and `namesMatch` accepts one extra word, which
printed "Notting Hill Bookshop" hours as Notting Hill's access.

**A place located to an island is drawn as one.** GROUP_CONCAT over P31, finest type
wins. Three gaps found by watching the live map: candidates have no P31 at all (fixed
with Wikipedia's `pageterms`, so Edinburgh stops being a dot), everything after " in "
is where a place is rather than what it is ("faculty in City of Edinburgh" made a
university building a settlement), and four missing words — "area of", "kirkyard",
"zoo", "market".

**Corrected**: this project believed Greyfriars Kirkyard carried `opening_hours: 24/7`.
It carries no access tag; that reading was the loose-name-match trap, measured twice.

**Updated**: `wiki/concepts/three-axes.md`, `wiki/handoff.md`

## [2026-08-05] rule-change | Provenance is enforced by the database, not by habit

**Object**: `supabase/migrations/20260805010000_provenance_is_required.sql`
**Scenario**: rule-change · **Outcome**: ✅ success
**Code changes**: `4032311`

Owner's rule: when we enrich, we keep the source — which site, which page — so a claim
can always be traced back. It was already the convention and it was already broken.
Measured before writing anything: **92 links, 8 with no evidence row at all.** Checked
against Wikidata, five correspond to real P840 statements and **three do not exist
there** — Skyfall→Hashima Island, Skyfall→National Gallery, Harry Potter→London Zoo.

Those three are probably TRUE — Hashima is the acknowledged model for Silva's island,
the zoo is the snake scene — and that is the argument. With no recorded source there is
no way to tell a right row from a wrong one, and "probably true" is the state this
project exists to refuse.

`place_evidence` now requires an identifiable source (a URL or a statement ref; a
snippet describes a source and cannot replace one), and `work_place_links` requires at
least one evidence row via a **deferred** constraint trigger, so link and evidence write
in one transaction as they actually do. Verified live both ways. Both are `not valid`
rather than retroactive and `links_without_evidence` lists the debt: validating would
fail on rows nobody can now source, deleting them would destroy probably-correct facts,
and an invented citation is worse than visible debt.

Subtlety worth the entry: a deferrable-initially-deferred trigger fires at COMMIT and
cannot be caught by an exception block in the same transaction. The first test reported
the rule was not working when it was.

**Updated**: `wiki/concepts/place-precision.md`

## [2026-08-05] update | Three axes for judging a place, and two relations it could not express

**Object**: `app/lib/place-grade.mjs`, `app/lib/place-access.mjs`,
`app/lib/work-profile.mjs`, `app/lib/scene-frame-match.mjs`,
`supabase/migrations/20260805000000_inspiration_and_replica.sql`
**Scenario**: feature · **Outcome**: ✅ success
**Code changes**: `f31316b`, `f214602`, `68c8f0d`

**Precision became its own axis** (owner, 2026-08-04): a source saying a film was shot
on an island does not put the island on the map as a point, but as an area where the
exact spot is unknown. Evidence and precision are orthogonal and are never multiplied —
a single number cannot say which is missing, and the fixes are opposite. Fan knowledge
is kept: thin evidence marks a precise place unconfirmed, never hides it.

**Then access became a third axis**, because precision and access disagree in BOTH
directions. Culross and Falkland are villages — coarse precision — and are the two most
walkable stops on a real Outlander itinerary. Midhope Castle is building-precision and
is a ticketed gate on a private estate with an interior shut to everyone. Showing and
routing are therefore different promises: `canShow` admits an unknown, `isRoutable`
refuses it, aimed at the one case where a self-guided map is worse than a coach.

**Two relations the map had to lie about.** `inspiration_for` — Thomas Riddell's grave
is not a filming location and is not where the story is set; the inverted search already
found it and there was nowhere to put the answer. `replica` — the Green Dragon and
Bagshot Row's interior were built for visitors and never shot in. Carried through to
`placeRole` rather than stopping at the schema, and `isMatchablePlace` now refuses all
three never-filmed kinds: a vision model comparing a frame to the Green Dragon would
agree enthusiastically and be entirely wrong, because it was built to look like that.

Three services this session have now reported failure inside a success: Wikimedia's
error in a 200 body, OpenRouter's silently ignored schema, and Overpass answering "the
server is probably too busy" with HTTP 200 and an HTML page.

**Updated**: `wiki/concepts/three-axes.md` (new), `wiki/index.md`

## [2026-08-05] update | The viewport is the question, and the inverted search

**Object**: `app/lib/place-search.mjs`, `app/lib/nearby.mjs`,
`app/api/locations/route.js`, `app/components/SceneMapApp.jsx`
**Scenario**: feature · **Outcome**: ✅ success
**Code changes**: `cf204f9`, `2ee4984`

**The inverted search** finds places whose OWN article mentions a work — the category
that lives on the place's page and nowhere else. Three things had to be right and each
was found by measurement: filter geographically inside the query (`nearcoord:` gave 10
of 10 results with coordinates where a plain search gave 2 of 50), use the REGEX form of
`insource` (the quoted form misses "Rowling's"), and fan out to the work's characters
(neither "Harry Potter" nor "Rowling" reaches Greyfriars — the article links only to
[[Lord Voldemort]]). And one trap: CirrusSearch's own `OR` between insource clauses
returns ZERO rather than erroring, so the alternation lives inside one regex.

Verified general: Dracula in Whitby returns the Abbey, St Mary's Church and the 199
Steps; The Hound of the Baskervilles in London returns Scotland Yard and Highgate
Cemetery.

**Zooming out now widens the search**, which needed four separate fixes: minZoom was 11
so a country could not be shown at all; the search refreshed on drag and not on zoom;
the radius capped at 50km and the API rejected more; and a viewport change cleared the
work query, so searching a film and zooming dropped the film. Measured on Edinburgh:
15km→8 places, 120km→10, 500km→15.

**Updated**: `wiki/concepts/three-axes.md`

## [2026-08-04] update | Two features that were finished and unreachable

**Object**: `app/components/SceneMapApp.jsx`, `app/lib/location-search.mjs`,
`app/api/locations/route.js`, `app/globals.css`
**Scenario**: bugfix · **Outcome**: ✅ success
**Code changes**: `157574d`, `b072401`

**The personal library could not be opened without an account.** Both halves of it were
written and correct — verified against a real 2,422-film Letterboxd export, parsed in
52ms, with `workIsInLibrary` matching 8 of our 12 works and all four misses being real
absences. What did not exist was a door: the header button sent an anonymous visitor
straight to Google OAuth, and the import UI and the map filter both live inside that
panel. The library is stored under a guest key, so guest use was always the intent.

The filter also sat three clicks and a redirect away from the map it filters. It now
sits above the work chips and appears only once there is a list to filter by. This was
the **fourth** time in this project that finished work was invisible because it never
reached the live path, after posters, ratings and three audio features.

**A title search was trapped by the current city.** Typing "Notting Hill" while looking
at Paris returned an empty map — 1 place from London, 0 from Paris; "Amélie" the mirror
image. A radius answers "what is near me", which is right for a place search and wrong
for a title search: somebody typing a film name is asking where that film is. The radius
now decides what counts as *here*, not what exists, and the map moves to the results
when the current city has none. From London, "Amélie" went from 0 places to five.

Surfaced and not fixed: "Skyfall" still resolves to Adele's lyric video rather than the
film, and per-work Wikidata place lists are thin — one place for Notting Hill.

**Updated**: `wiki/concepts/personal-library.md`, `wiki/concepts/location-discovery.md`

## [2026-08-03] ingest | Filming permits — the first primary source in the project

**Object**: `app/lib/film-permits.mjs`, `scripts/ingest-film-permits.mjs`,
`supabase/migrations/20260803000000_submission_source_kind.sql`
**Scenario**: feature · **Outcome**: ✅ success
**Code changes**: `72c5f2e`

Every other source here is somebody's **account** of where a film was shot. A permit
record is not an account: the city granted permission to shoot at an address on a date,
and the record is the primary document. No prose to extract, no gazetteer round trip,
**no model call**, and no coordinate for anything to invent.

Verified live on Paris: **14,760 records, ODbL**, published by the city's own Direction
des Affaires Culturelles. It found The Crown in our existing works with no new data — ten
Paris addresses from the 2022 shoot, among them souterrain Alexandre III, place Vendôme
and place de la Concorde. A walkable route where every stop is a municipal record.

They still land as `pending`. A permit is authorisation, and productions abandon
locations, so this is a different KIND of evidence from a sentence, not a stronger grade
of the same kind. The queue could not express that: `source_revid` and `source_sentence`
were both NOT NULL and both are Wikipedia concepts, and `source_license` carried
`default 'CC BY-SA 4.0'` — true while Wikipedia was the only writer, and **a false
statement in the database** the moment anything else wrote. ODbL is share-alike on the
database itself, which is not a licence you can infer.

The coverage window matters more than the count: the Paris set begins in **2016**, so it
holds Emily in Paris (255 locations) and nothing at all for Amélie. An empty answer for a
classic is the correct answer.

One correction: the title guard first demanded two words, which silently skipped
"Skyfall", "Amélie" and "Parasite" for a risk `titleMatches` already covered. Correctness
lives in the match, not in the query.

Checked the neighbours too. San Francisco is a straight second instance. **New York fits
the pipe and not the product** — MOME withholds production names, so the dataset cannot
answer "which film shot here".

**Updated**: `wiki/concepts/film-permits.md` (new), `wiki/index.md`

## [2026-08-03] decision | Fandom and IMDb, looked at and refused

**Object**: N/A — source evaluation
**Scenario**: rule-change · **Outcome**: ✅ success
**Code changes**: none — the value is in not building it

**IMDb has no paid path.** Beyond the scraping prohibition and the non-commercial user
licence, IMDb **does not own most of the photos** — its own terms say "IMDb *or its
content suppliers*". There is no licensing department to ask, because the rights are not
IMDb's to sell.

**Fandom fails on evidence before it fails on licence.** Licences vary per wiki, verified
live: Memory Alpha is CC-BY-NC and Minecraft CC BY-NC-SA. A correction to the obvious
advice — "read the licence from `url`, not `text`" fails on its own example, since
Minecraft declares NC in the text while pointing at the farm-default URL.

But the decisive reason is different. The "Filming locations" category is **empty on the
Bond, LOTR and Harry Potter wikis**. And a Fandom row would satisfy the *letter* of our
guarantee — named page, verbatim quote, permalink — while the claim underneath is
anonymous and unsourced. Verifying it means finding a real source, at which point that
source is the citation and Fandom contributed a name.

Recorded because a refusal is worth as much as a build: without this the same appealing
idea returns every few weeks and gets researched again.

**The trap worth remembering**: our homonym rule refuses Cambridge-vs-Cambridge, where
there is real ambiguity. It does nothing against **Derry, Gotham, Springfield, Amity** —
fictional places that resolve to exactly one real settlement, confidently. A fictional
place that geocodes cleanly is the best-looking row in the queue. Exposure is currently
low because narrative places only map into our own closed list, but this is what waits
for the books branch.

**Updated**: `wiki/sources/source-evaluation.md` (new)

## [2026-08-03] update | Model calls moved to free providers, and the geocoder rebuilt

**Object**: `app/lib/model-client.mjs`, `app/lib/geocode-wikidata.mjs`,
`app/lib/geocode-client.mjs`, `app/api/trail/route.js`, `app/api/tour/route.js`,
`app/lib/wikipedia-source.mjs`, `app/lib/wikipedia-extract.mjs`
**Scenario**: feature + bugfix · **Outcome**: ✅ success
**Code changes**: `8a9fd8f`, `d91f2f5`, `3ee0774`, `d19c6d1`, `2fab406`, `23ab2fa`

**The provider swap was not the change it looked like.** OpenRouter's `/responses`
endpoint exists — but returns HTTP 200 with `status: "completed"` while **ignoring the
schema entirely**, answering with the model's reasoning prose. A structured-output
request that succeeds and returns unstructured text is the worst failure available.
`chat/completions` honours it, and both providers accept that shape, so there is one code
path. Enrichment, trail and tour now run on `google/gemma-4-26b-a4b-it:free` — the only
free model that survived the real extraction schema.

The **tier** is named at the call site, never inferred from the environment: a careful
task must not land on a free endpoint because someone added a free key.

**The geocoder never actually worked.** The class filter `wdt:P31/wdt:P279* wd:Q618123`
was correct and cost **65 seconds and HTTP 504 for a SINGLE name**. Batch size was never
the problem. Four more defects behind it, each a case of naming the right action and not
taking it — the retry plan said "shrink" and the caller skipped; the `near` hint resolved
"Istanbul" to a **pub in Manchester**; a ratio rule for population picked the state of
Australia for "Victoria" among 110 candidates.

**Reading several language editions is not redundancy.** French carries "Tournage" and
Japanese "ロケーション" inside sections English lacks. Measured: English alone gave 25
places and 14 coordinates; adding French and German gave 32 and 17 — including Pinewood
and Longcross Studios and Buachaille Etive Mòr.

Two test harnesses turned out weaker than production. `/api/tour` had **no test at all**,
and migrating it left a dangling `response.model` that reached a live request. The trail
harness handed back `output_parsed` directly and so never exercised the schema — its
fixture was missing a required field.

**Updated**: `wiki/concepts/model-providers.md` (new),
`wiki/concepts/geocoding-cascade.md`, `wiki/index.md`

## [2026-08-02] update | The discovery path stopped inventing coordinates (#121)

**Object**: `app/lib/location-discovery-schema.mjs`, `app/api/locations/discover/route.js`,
`app/lib/geocode-client.mjs`, `app/lib/wikipedia-source.mjs`, `scripts/enrich-from-wikipedia.mjs`
**Scenario**: bugfix + rule-change · **Outcome**: ✅ success
**Code changes**: `29ca3f8`, `b3ec14c`

**#121 — we were asking the model where places are.** The web-research path had `lat` and
`lng` in its output schema and an instruction reading "Give precise coordinates for the
named public place". That is the one thing this project exists not to do, and it had been
shipping to the live map: results were labelled "sourced places" beside genuinely verified
Wikidata points.

Worse than the invention was what it did to everything downstream. The radius check
confirmed only that the made-up point was *plausibly located*; the identity string
`web-<slug>-<lat>-<lng>` baked it in; the dedup compared invented positions. **A recalled
coordinate has no identity, only a position** — so the same place found twice became two
places.

The model now returns a name and its citation, and names become points through the same
Wikidata geocoder [[wikipedia-enrichment]] uses. The city being viewed became a real
disambiguation hint — and it comes from the request, never from the model. A name the
geocoder refuses is returned as `unplaced` and reported in the UI, because "found three,
could place one" and "found one" are different statements and silence read as the wrong
one. Identity became the Q-id, so a place found by both paths is now recognised as one
place. New: [[geocoding-cascade]].

**A lagged replica is not a missing page.** The first real enrichment run died on its
first call with `maxlag: Waiting for wdqs1013: 7.95 seconds lagged` — from a call that
sits *outside* the per-work error handling, so a few seconds of routine replication lag
abandoned the whole run. Wikimedia answers both a missing article and a lagged replica
with HTTP 200 and an error body; the script treated them alike. They are opposite
problems, and the same mistake as conflating 504 with 429 in the geocoder a day earlier.

Measured rather than guessed: the response carries `retry-after: 5` alongside
`x-database-lag: 8`, so the suggested delay is a floor, not a promise — repeating it
unchanged asks the same question five times against a lag that is not moving. The
threshold moved off 5 for a reason that is about us, not about them: five is the value for
a bot making **edits**, and we read article titles that change on the scale of years, so
being turned away by an eight-second-stale replica protects nothing. 30 still refuses a
real incident, which runs to minutes.

**Updated**: `wiki/concepts/geocoding-cascade.md` (new),
`wiki/concepts/wikipedia-enrichment.md` (new), `wiki/concepts/location-discovery.md`,
`wiki/index.md`

## [2026-08-01] update | Wikipedia prose became a third source, behind a review queue (#47)

**Object**: `app/lib/wikipedia-source.mjs`, `app/lib/wikipedia-extract.mjs`,
`app/lib/geocode-wikidata.mjs`, `scripts/enrich-from-wikipedia.mjs`
**Scenario**: feature · **Outcome**: ⚠️ partial — built and verified against the live
APIs; the extraction step has not yet run on real films (needs `OPENAI_API_KEY` locally)
**Code changes**: `198c86d`, `7d53d2b`, `fab9aa3`, `69e56fe`

Wikidata's P915 covers a few thousand films; thousands more describe where they were shot
only in their article's "Production" section. This is the first path where a place enters
the graph without a canonical statement behind it, so everything it produces arrives as
`pending` in `location_submissions` — nothing reaches the map unreviewed.

Two rules are built into the shape rather than bolted on. The extraction schema has **no
coordinate field**, so the model cannot supply a point — a stronger guarantee than telling
it not to guess, and the rule #121 then retrofitted onto [[location-discovery]]. And every
returned sentence must appear **verbatim** in the prose we supplied or its location is
dropped, because the scene matcher demanded a model justify itself, received a fluent and
specific justification, and shipped a fabricated match. *Demanding evidence is not the same
as checking it.*

Several external constraints turned out to be the opposite of a reasonable guess, and were
verified live: a default User-Agent gets HTTP 403, not a throttle; `action=parse&section=`
takes the section's `index` and index is **not** `number` (on "Lost in Translation" it is
8 versus 4, and passing the wrong one silently returns different prose); errors arrive
with HTTP 200. On the geocoder, a 40-name batch returns HTTP 504 — reduced to 8.

Refusing is the feature: two genuinely different places sharing a name are **not** resolved
by taking the more populous one. Many accepted places therefore queue without a coordinate,
which is intended — the claim is still real and reviewable.

**Known gaps**: books have no "Production" section, so the thinnest works get nothing; only
tier 1 of [[geocoding-cascade]] exists; the submissions queue has no review UI yet.

**Updated**: `wiki/concepts/wikipedia-enrichment.md` (new)

## [2026-07-28] update | Write routes closed, walk mode surfaced, story trail joined up

- **#120 — the write routes were open.** Six of them wrote to the database and spent
  real money with no authentication, all holding the service-role key so RLS never
  constrained them. Closed behind a token, verified on production: 401 without and
  with a wrong token, 200 with the right one. Two properties matter more than the
  mechanism — it **fails closed** (a missing token shuts the route, because "no
  secret configured, so let everyone in" is how a guard silently stops guarding), and
  the comparison is constant-time. The guard runs before the body is read, so an
  unauthorised request costs zero model calls; the tests assert that with stores that
  throw if reached.
- **#114 turned out to be a decision, not a layout pass.** The rule: **features about
  being outside live on the map, not in the panel.** The panel is for choosing what to
  see; the map is for walking. That one sentence released #63 and #64, whose logic had
  been written, tested and invisible for weeks because each new thing queued behind
  "where does it go in the panel?".
  * Placement then took two corrections, both the *same bug the issue was about*: a
    floating control landing on a panel. Bottom-left sat under the command panel on
    desktop; the phone bottom is contested by BOTH the location sheet and the collapsed
    panel, so there it takes the top edge — the only free one.
- **#71 — the blocker was never the UI.** The extractor named places as the STORY does
  ("Notting Hill Bookshop", "William Thacker's flat"), which is right for a story and
  unmappable for us. Fixed by handing the model the places we already hold and letting
  it pick one **or none**.
  * It named them correctly and then left `known_place` null in 21 of 22 cases — so the
    link now also matches the scene's own name against the *same closed list*. Not
    fuzzy matching smuggled back in: "Diagon Alley" and "Hogwarts" still find nothing.
  * Backfilled the existing scenes in SQL rather than re-extracting — the names were
    already ours, so paying the model again would have bought nothing.
  * A schema constraint had to go: `(work_id, place_id, relation_kind)` unique forbade
    Skyfall visiting London in scenes 2, 7 and 9. A plot that doubles back is exactly
    what the dashed numbered line exists to show. Split into two partial indexes so
    work-level uniqueness still holds.
  * Result: Skyfall has a real 7-stop trail — Istanbul → London → National Gallery →
    Shanghai → Hashima Island → London → London. Gaps at 5 and 8 are Macau and the
    lodge, which we do not hold; only places we have become stops.
  * The trail then drew ONE stop, and the spoiler shield was right: at progress 0 the
    server withholds unreached scenes' coordinates entirely, so a plot cannot leak
    through the shape of a line. Safety is only usable with a way out, so there is one
    control that states its cost in the label. 1 stop → 7 on opt-in.

### The worktree rewound again, and the test count caught it

- Mid-session `git status` showed HEAD back at the commit this session STARTED from.
  Everything since had vanished from the working copy, and the last half hour of edits
  had been written against stale files — the `trail/route.js` in front of me had no
  #120 guard in it.
- **What caught it: the test count fell 588 → 388.** Exactly the signal that caught the
  same failure once before (280 → 130). Nothing else looked wrong.
- Nothing was lost: every commit had been pushed, so `origin/main` held all of it.
  Recovery was stash → `reset --hard origin/main` → pop, then checking that BOTH the
  guard and the new work survived the merge before trusting it.
- Also: `git push` after the reset went to the branch, not main — the same rewind. Worth
  checking `git branch --show-current` after any hard reset here.
- Standing lesson: **a falling test count is the tripwire for this repo.** Run the whole
  suite, not one file, and read the total.

## [2026-07-28] update | Film profile, verified frames, and a fabricated match

- The film profile (#107, #110) shipped: poster, scores that link back to the page
  they were read from, every place we hold with its precision badge, and the film's
  images. Reachable from the live chips AND from the graph layer — the latter
  matters more, since the graph holds the works with the most places and the
  profile could not reach them at first.
- **Two features turned out to be built but wired into the wrong panel.** Posters
  and then ratings both existed and worked, but rendered only inside the "Grounded
  places" layer, so nobody looking at a film ever saw them. Third occurrence of
  the same shape — worth watching for: work lands in the graph layer and never
  reaches the live path people actually use.
- **The studio test was a regex on the place NAME** (`/studio/i`), which calls the
  "Studio Ghibli Museum" a soundstage and misses any lot without the word. The
  resolver had already derived `place_class` from P31 ancestry; the profile uses
  that. Direct violation of the project's own rule, sitting one join away from the
  right answer.

### Frames: three tiers, and what each is allowed to claim

- **Tier B — "from the film"**: TMDB files production stills and promotional key
  art under one `backdrops` list. My first fix filtered on the language marker and
  I shipped it as solving the problem. **It does not.** Verified on production:
  Skyfall's stills list was byte-for-byte identical before and after, because its
  gun-barrel art is textless too — a silhouette honestly contains no text. It is
  simply not a frame from the film, and no metadata field carries that.
  * The real answer is to look at the picture. A deliberately narrow question —
    "is this a photographic frame?" with no place involved — so it is cheap and
    **permanently cacheable**: every image is paid for once, ever. Rejections are
    stored too; without a negative row the same poster is re-judged every visit.
  * Result across 12 films: 144 images judged, **69 real frames — 48%**. So more
    than half of what the gallery had been showing was marketing.
  * The Crown scored 0/12. Checked by eye before accepting it: three-panel cast
    composites and posed press photography under a portrait of the Queen. Correct.
- **Tier A — "shot HERE"**: this is the product's central claim and the easiest
  thing to get wrong, because a model asked "does this match?" finds a way to
  agree. The design assumes NO: only places precise enough for the question to
  mean anything, only with a reference photograph, never a studio, only high
  confidence, and the evidence is a NOT NULL column.
- **It still fabricated one.** First production run matched a misty Scottish road
  to Hankley Common, a sandy Surrey heath, justified by *"sandy dirt road leading
  uphill, sparse trees and white surveying posts"*. That frame has a PAVED road,
  no trees and no posts — it had described the REFERENCE photo and asserted those
  features were in the frame. Because the sentence was fluent and specific, every
  gate passed it. **Demanding evidence is not the same as checking it.**
  * Fixed by re-examining the claim with **only the frame in view**. With nothing
    to conflate it with, "is this visible here?" becomes answerable. Phrased to
    refute, lists what it cannot see BEFORE the verdict, and told that merely
    plausible is not visible. It immediately caught 4 fabrications including that
    one, naming exactly what I had seen was absent.

### Why tier A currently yields nothing

- Zero matches across 12 places, and the honest reading is that the SOURCE is
  wrong, not the matcher: in 8 of 12 the first pass itself declined.
- The pool was also starved by my own cap. Skyfall has **98 images on TMDB and I
  judged 12** — and the top twelve by vote count are the worst twelve, because
  posters and cast hero shots are what people vote on. Harry Potter's four
  verified frames were character close-ups: three children in a train doorway,
  no location in shot at all.
- Raised to 48 per film in batches of 12 (indices are how a verdict finds its
  image, so each batch is numbered locally). Skyfall went 4 → 18 frames, Harry
  Potter 4 → 9. Re-ran the matcher: **still zero.**
- Conclusion to carry forward: a film's TMDB gallery is a marketing asset chosen
  to sell the film through its actors, not a location survey. Tier A is sound and
  refuses correctly; it needs a different source of frames. Deliberately did NOT
  loosen the thresholds to manufacture a positive — that would reinstate exactly
  the failure just removed.
- No false match exists in production; the one bad row was deleted from
  `pre_snap`-style provenance columns' sibling, `place_frames`.

## [2026-07-27] incident | The map was dead in production for every visitor

- Reported from an iPhone screenshot: the whole app showed "Something went wrong".
  Not a regression from that day's work — the identical error and the identical
  chunk hash were reproduced on a deployment predating it, so it had been live
  for some time. The `/api/map/points` endpoint was healthy the entire time;
  the crash was purely client-side.
- Cause: `SceneMapApp` threw `Cannot access 'activeLocation' before
  initialization` on render, and the error boundary swallowed the entire app.
  The image-attribution effect (#60) sat ~60 lines ABOVE the `useState` that
  declares `activeLocation`, and **a dependency array is evaluated during render,
  at the point its hook call appears** — so `[activeLocation?.now]` touched the
  binding while it was still in the temporal dead zone.
- The trap: **optional chaining does not protect against TDZ.** `activeLocation?.now`
  reads as if it guards the access, but the dead zone rejects touching the binding
  at all, not just reading a property off it. The code looks defensive and is not.
- Three gaps let it ship and kept it hidden:
  * `next build` compiles it happily — this is a runtime error, so a green build
    proves nothing about it.
  * The repo has **no linter at all** (which is why every build carries
    `--no-lint`); `no-use-before-define` would have caught it instantly.
  * Minified, the message is `Cannot access 'tf' before initialization` in a
    vendor chunk — unreadable, and it points nowhere near the real file. Running
    `next dev` and reading the console gave the exact file and line in seconds.
- Guard: `test/hook-order.test.mjs` walks every `use…()` call to its final
  argument and fails when a dependency array names a binding declared further
  down the file. It handles inline and multi-line arrays and skips strings and
  comments so brackets cannot be miscounted. Verified by reverting the fix — it
  reproduces the exact finding — and it found no other instances.
- Worth remembering: a screenshot of a broken UI is a better bug report than any
  green test suite. 453 tests passed while the app was completely unusable.

## [2026-07-27] update | Building-footprint snap (#45) + place dedup (#46)

- Both shipped to production. Both were reshaped by checking real data before
  writing the feature, and in both cases the naive version would have destroyed
  information rather than added it.
- **#46 dedup**: the brief asked to group places by proximity + name. Queried the
  live graph first: the six closest pairs we hold are all DIFFERENT places — the
  National Gallery stands *on* Trafalgar Square (95 m), Aldwych station *on* the
  Strand (227 m), and "London" is a CITY centroid that lands 100 m from Trafalgar
  Square. A "within N metres" rule merges all six. The London pair is the
  dangerous one: it converts a source that said only *"London"* into one claiming
  Trafalgar Square.
  * So three rules, all required: distinct Wikidata entities stay distinct
    (Wikidata already decided they are different things), precision buckets never
    mix (a city centroid is a different KIND of claim from a building), and names
    must agree. Verified on production: **63 places → 63 groups, 0 merges.**
  * Merging is deliberately non-transitive — a candidate joins a group only if it
    matches every member, or a chain of 40 m hops would swallow a whole street.
  * Places needed their own name normaliser: `normalizeWorkTitle` folds to
    `a-z0-9`, which empties "Красная площадь" and "東京タワー" entirely and would
    have silently disabled dedup for most of the world.
- **#45 footprint snap**: containment decides before proximity. A point inside
  exactly one footprint identifies that building, which is what makes this work in
  a dense street — Selfridges had **six** candidates within 60 m. Only when nothing
  contains the point does a lone nearby building count; anything else is ambiguous,
  and an ambiguous snap is not a snap.
- Four things only production could teach:
  * **Shanghai snapped `city` → `building`** and moved 16 m, because a city
    centroid happens to fall inside a tower. That is the exact fabrication this
    project exists to refuse. Fix: a place known only to its city or country must
    be confirmed by the building's NAME. Gloucester Cathedral inside a footprint
    OSM also calls "Gloucester Cathedral" is evidence; Shanghai inside an unrelated
    tower is a coincidence. The bad row was reverted from `pre_snap_*` — which is
    why those columns exist.
  * Overpass **429s the request straight after a successful one**. A 1.5 s pause
    lost 3 of 6 places, so the base pause is 5 s (measured, not guessed) and a 429
    now doubles it for the rest of the run instead of being logged and forgotten.
  * The area centroid had to be computed against a local origin: cross products of
    raw degrees resolve a 40 m building to ~1e-8 and lose it to floating-point
    cancellation.
  * A centroid can fall OUTSIDE its own footprint — a U-shaped building's centre is
    in the courtyard — so it is rejected when it does, and a snap that would drag
    the pin >100 m (an airport, a campus) is refused outright.
- Live results: Gloucester Cathedral `city`→`building` on `way/88313379`,
  Leadenhall Market (4 m), London Zoo (14 m), Harrow School (57 m). Correct
  refusals: London and Istanbul (cities), Alnwick Castle and Goathland station
  (multi-building complexes), Glen Nevis and Japan (no buildings at all),
  Trafalgar Square (a square, not a building).
- The pre-snap coordinate is always kept, so every moved pin stays provable and
  reversible. OSM is ODbL — attribution ships with every snapped coordinate.

## [2026-07-25] update | Geo-triggered narration (#63) + story trail extraction (#71)

- PR #119 merged and live. Together these make a tour something you WALK rather
  than something you read.
- **#63 geo-trigger**: three constraints drove the design.
  * Autoplay is blocked until the user gestures, so playbackState has a
    "needs-unlock" state and the UI asks for one tap up front. Without it the
    walker reaches the first stop and hears silence — with nothing to tap, because
    the promise is that no tapping is needed.
  * Each stop speaks ONCE: fixes arrive constantly and GPS jitters across the radius
    boundary, so without de-duplication the narration restarts every few seconds
    while standing still.
  * A fix with stated accuracy worse than 120 m fires nothing — a trigger is a claim
    about where you are. An UNREPORTED accuracy is trusted, since some browsers omit
    it and refusing those would break the feature.
  * One narration at a time (the nearest): two guides talking over each other is
    worse than a slightly late second one. A 12 m movement threshold stops jitter
    from draining the battery.
- **#71 story trail**: walking a work in STORY order rather than by geographic
  convenience — stop 3 is what happens after stop 2 even if it means walking back
  past stop 1.
  * The extraction schema has NO coordinate field, so the model cannot invent a pin
    even by accident; it proposes a place NAME and the resolver does the rest.
  * sequence_index is explicit — array order survives neither a model response nor a
    database insert. Duplicates are dropped and the trail RENUMBERED 1..N so gaps do
    not become holes in the walk.
  * A missing spoiler_tier defaults to the scene's own position: guessing "safe"
    would show someone the ending.
  * A fictional setting stays a scene but never gets a coordinate.
  * POST /api/trail caches into the scenes table; an empty extraction is returned
    honestly and NOT cached, since caching "nothing" would permanently mark a work
    as having no story.
- **Verified live end to end on Notting Hill**: first call extracted 6 scenes
  (correctly flagging William's flat and Bella's house as fictional settings while
  The Savoy and Hampstead Heath are real); second call returned cached in 0.8s with
  no model call; and #72's protection then worked on REAL data — progress 0 revealed
  0 of 6 with every beat hidden, progress 1 revealed all 6.
- This closes the loop opened last round: the spoiler machinery finally has scenes
  to protect.
- 383/383 green. UI placement for both deferred to #114.

## [2026-07-25] update | TTS cache (#66 closed) + walk mode foundations (#64)

- PR #118 merged and live. Two halves of the same walk: the guide must be instant
  and free to replay, and it must keep working while someone is actually walking.
- **#66 TTS cache**: key = hash(text, voice, model) in a public-read Supabase
  bucket, so a hit is served by the CDN and never touches the model. Invalidation
  needs no purge step — editing a narration changes the hash, so the stale clip is
  simply never requested again.
  * Verified on production: first call 3.34s "miss" (generated, paid), second call
    1.17s "hit" (free), byte-identical output.
  * Losing the cache must never mean losing the feature: a storage read that throws,
    or a deployment without the service-role key, falls through to generation. The
    write is not awaited and its failure is logged, never surfaced.
  * Path segments strip dots (traversal), and key parts are joined with a separator
    that cannot appear in them, so ("ab","c") and ("a","bc") cannot collide.
  * /api/narration converted to the DI-factory style used by the other routes; the
    two existing narration tests still pass unchanged.
- **#64 walk mode** (logic + hook; UI placement deferred): with the screen off,
  browsers throttle watchPosition, so geo-triggers stop firing and the guide goes
  silent exactly when needed.
  * app/lib/walk-mode.mjs: stops are followed IN ORDER (nearest-first would march
    the walker back and forth), arrival is a 35 m radius (GPS noise), and ETA rounds
    to NEAREST with a one-minute floor — rounding up called an 80 m stroll "2 min",
    and an ETA that is obviously wrong stops being read.
  * useWakeLock: the browser RELEASES the lock whenever the page hides and does not
    restore it, so the hook re-acquires on visibilitychange. Without that, walk mode
    dies after the first glance at another app — the failure it exists to prevent.
    A denied lock is reported, not thrown; support is detectable so the UI can say
    the screen may dim.
  * The banner and toggle are deliberately NOT in the side panel yet — per the rule
    added after the mobile incident, nothing new goes there until its phone home is
    decided (#114).
- 351/351 green.

## [2026-07-25] update | Place-photo source cascade (#56 closed) + worktree fallback fixed

- PR #116 merged and live. "The place today" now comes from a cascade whose ORDER
  is a licensing decision: Mapillary (CC BY-SA, storable, reports compass_angle) →
  Wikimedia Commons (per-file, storable) → Street View (NOT storable — Google's
  terms forbid caching the imagery, so it is a live embed only and can never enter
  a saved before/after composition). Sources are never mixed, so the credit shown
  always matches where the image came from.
- Ranking is distance PLUS a facing penalty capped at 90: a photo of the wrong wall
  is not a photo of the place however close it was taken. That is the whole point
  of compass_angle.
- Mapillary preview URLs carry a TTL, so the module keeps the IMAGE ID, never the
  URL — a stored URL silently stops resolving.
- The #60 fail-safe now does real work: a Commons file with no author or licence
  falls through to the next source instead of appearing uncredited.
- Verified live: Trafalgar Square → "CGP Grey · CC BY 2.0", storable, 10 Commons
  candidates; Mapillary degrades cleanly to 0 with no token.
- **Third sighting of the same trap**: an ABSENT lat/lng became 0,0 because
  Number(null) is 0, so a coordinate-less request would have searched the Gulf of
  Guinea. Already fixed in the resolver and the map viewport parser; guarded here
  and pinned by a test. Worth treating as a repo-wide rule: never Number() a query
  parameter without rejecting absent values first.
- MAPILLARY_TOKEN / GOOGLE_MAPS_EMBED_KEY are optional — those tiers are skipped
  rather than failing when unset.
- **Environment fix**: the agent worktree kept being restored to its own branch
  (claude/hackathon-prep-<id>), silently rewinding the tree to the session's first
  commit; once that meant editing stale files, caught only because the test count
  fell from 280 to 130. That branch now points at main, so the restore is a no-op.
  Recorded in .loops/guardrails.md.
- 308/308 green.

## [2026-07-25] update | Image attribution — one credit component, fail-safe by default (#60 closed)

- PR #115 merged and live. Became urgent with this week's TMDB posters and OMDb
  ratings: both require a credit we were not showing.
- **The rule**: an image whose attribution we cannot state is NOT shown — the same
  principle as the map, where we never display what we cannot source.
- app/lib/attribution.mjs (pure, 9 tests): one normalised shape per source
  {source, author, license, license_url, source_url, notice}. isDisplayable() is
  the gate — a PER-FILE licensed source (Commons, Mapillary) missing its author or
  licence is refused, because republishing a photo without the credit its licence
  requires is a breach, not a missing caption. An unknown host is refused too.
- app/lib/commons-metadata.mjs (pure + injectable fetch, 10 tests): Commons
  licences are per FILE, so knowing an image came from Commons is not permission to
  publish it. Fetches author + licence from extmetadata and strips the HTML Commons
  wraps them in. Missing fields come back missing, never invented.
- GET /api/attribution returns an EMPTY map on failure, so the client keeps the
  image hidden rather than showing it uncredited.
- The two terms-required notices (TMDB non-endorsement; OMDb/IMDb/RT/Metacritic
  marks) now render once per page.
- **Bug only the real API could reveal**: the endpoint took a comma-separated
  `urls` list, but Commons filenames routinely contain commas ("Trafalgar Square,
  London 2 - Jun 2009.jpg"), so the URL was torn in half and the lookup silently
  returned nothing — the photo would have stayed uncredited for an invisible
  reason. Now repeated `url` params, with a regression test.
- Verified on production: Diliff / CC BY-SA 3.0 with its licence link.
- 290/290 green.

## [2026-07-25] incident | The map was invisible on a phone (32px on an iPhone 15 Pro)

- Reported from a real device: "the map is covered by menus". Measured against a
  393x852 viewport it was worse than it sounded — .command-panel 42vh (358px) plus
  .location-sheet 50vh (426px) plus 36px of gaps left **32px** for the map, while
  the panel's own content was 1268px tall.
- **Cause is process, not CSS.** Every feature added lately (layer legend, cover
  grid, work card, type-ahead) went into the same side panel. On a desktop the
  column just grows downward and nobody notices; on a phone it eats the screen.
- Fix (PR #113): on <=860px the panel is a BOTTOM sheet, collapsed to a handle by
  default — ~796px of map instead of 32. Expanded it overlays at 78vh, which is
  fine because the user asked for it. One CSS rule hides everything but the
  handle, so no markup was restructured, and desktop is untouched.
- **app/layout.jsx had NO viewport export at all**, so viewport-fit=cover was never
  set and env(safe-area-inset-*) resolved to zero — the sheet sat under the home
  indicator on a notched iPhone. Added with themeColor. Zoom deliberately NOT
  blocked: preventing magnification on a map is an accessibility failure.
- Also hit the repo's own guardrail while verifying: running `npm run build` while
  `next dev` was live corrupted .next (they share it) and the dev server 500'd.
  Fixed with rm -rf .next. The guardrail is in [[deployment-pipeline]] — worth
  re-reading before reaching for a build during a browser check.
- Systemic follow-up opened as **#114**: tablet and landscape layouts, 44px touch
  targets, on-screen keyboard, and PWA/installable — plus the rule that nothing
  new goes into the side panel until its phone home is decided.
- Verification limit: the preview pane reports a 0x0 viewport, so rules and
  behaviour were verified through the CSSOM, not pixels on a real screen.
- 271/271 green; deployed and confirmed live (safe-area-inset, panel-handle and
  viewport-fit=cover all present in the production bundle).

## [2026-07-25] update | IMDb-style type-ahead search over the graph

- PR #112 merged and live. Typing two characters already puts the obvious answer
  first, with the typed characters highlighted.
- **Ranking, not matching, is the hard part.** Trigram similarity ALONE ranks badly
  for short input — "sky" scores Sherlock and Skyfall almost alike, because
  similarity is dominated by length. search_works() scores exact and prefix hits
  explicitly ABOVE fuzzy ones (4.0 exact / 3.0 title-prefix / 2.0 word-prefix /
  1.x similarity), so similarity only breaks ties.
- Verified on production: sky→Skyfall, pot→Harry Potter, crown→The Crown, the typo
  skyfal→Skyfall, and zzzqq→nothing rather than a wrong guess.
- Matching runs on title_norm, backed by the GIN trigram index that already
  existed. No LIKE pattern is built from user input: starts_with()/strpos() take
  the query as a value, so a title containing % or _ cannot change the match.
- app/lib/work-search.mjs (pure, 9 tests): the query is folded by the SAME
  normalizeWorkTitle that produced title_norm, so "amelie" finds "Amélie".
  **Bug the tests caught**: highlighting means mapping a match found in the folded
  title back onto the original one. The first attempt re-normalised growing
  prefixes to find the offset — wrong, because the normaliser trims and collapses
  whitespace, so prefix lengths are not monotonic. It passed for "Skyfall" and
  failed for "Harry Potter". Now a per-character index map; tests on "Amélie" and
  "WALL·E" pin it.
- GET /api/search answers from the persistent graph. An empty query returns an
  empty list WITHOUT touching the database — still typing is not an error.
- WorkSearchBox: debounced, AbortController per keystroke, arrows wrap, Enter picks
  the highlighted row instead of submitting, Escape closes, combobox/listbox ARIA.
- It WRAPS the old search rather than replacing it: picking a grounded work shows
  it on the map, while submitting still runs the live Wikidata search, so titles
  we have not grounded yet stay findable.
- 271/271 green.

## [2026-07-25] update | Ratings (IMDb / RT / Metacritic) with source links; keys unblocked

- PR #111 merged and deployed. **32 ratings across 12 works, every one linking back
  to its source.** Verified on production: Skyfall → IMDb 7.8/10, RT 92%,
  Metacritic 81/100, all three clickable.
- Chain: work.wikidata_id → P345 (imdb id) + P1258 (RT path) + P1712 (Metacritic
  path) → OMDb → ratings. OMDb is a licensed aggregator and returns all three
  scores in one call, but NOT their URLs — hence the Wikidata paths.
- Two rules in app/lib/work-ratings.mjs (pure, 12 tests):
  * never restate a score in a scale its source did not use (IMDb "7.8/10" is not
    shown as "78%"); scores normalise to 0..100 only for sorting;
  * an unparseable score becomes null, never 0 — a missing rating and a rating of
    zero are different claims. Same reason a place with no coordinate stays NULL.
- Links are built only from validated identifiers, so a malformed path cannot make
  a chip point somewhere unrelated.
- **Owner supplied the two missing keys**: SUPABASE_SERVICE_ROLE_KEY (which
  unblocked /api/enrich/*, /api/resolve and /api/import/letterboxd — all three had
  been 503 in production) and an OMDb key, stored sensitive in Vercel.
- Artwork enrichment now runs unattended too; it reports "3 checked, 0 enriched"
  because only books remain, which have no TMDB entry.
- vercel.json: github.silent — every push had made vercel[bot] comment on the PR,
  and every comment became an email. Deployment status stays visible in checks.
- 258/258 green.

## [2026-07-25] update | Real film covers from TMDB + neutral Login button

- PR #109 merged, deployed, and the artwork pass run: **12 of 12 films/series now
  carry a real poster**; the 3 books are correctly skipped (no TMDB entry).
- **Source decision — TMDB, not an IMDb scraper.** The owner asked whether to pull
  posters like IMDb has, via third-party GitHub scrapers if necessary. We don't:
  IMDb's terms forbid extracting their content, the poster art is studio-licensed,
  and a scraper repo breaks on the next markup change. TMDB is the licensed
  official API, we already had a token and tmdb-images.mjs, and image.tmdb.org
  serves files with NO key — so only the path is stored and the client picks the size.
- Chain: work.wikidata_id → P4947 (film) / P4983 (series) → tmdb_id → poster_path.
  All 12 works had a TMDB id in Wikidata (verified live).
- app/lib/work-artwork.mjs (pure, 7 tests): kind picks the property so a movie id is
  never read as a TV id; only canonical /path.jpg passes, so nothing malformed can
  reach an img src; a failed lookup never nulls out existing artwork.
- POST /api/enrich/artwork, idempotent (loads only works with poster_path null),
  plus **?dry=1** which reports what would be written without touching the DB.
- **Blocker found**: `SUPABASE_SERVICE_ROLE_KEY` is not set in Vercel at all, so every
  service-role write route (/api/enrich/artwork, /api/resolve, /api/import/letterboxd)
  fails with 503 in production. The dry-run path plus a direct MCP write was used to
  land the posters; the key is still needed for these routes to work unattended.
- Login button: now a neutral "Login" with a generic icon instead of
  "Login with Google", which pinned one provider before the user chose. Full
  provider picker is #108.
- New issues: **#107** film stills + geolocation from a frame, **#108** login flow.
- 246/246 green. Verified on production: 12 covers render, CDN serves them keyless.

## [2026-07-24] update | Production deployed with the graph layer; CI deploy path half-fixed

- Production now runs the post-env-fix build. Verified on the live domain:
  /api/map/points → 28 London points, 3 studios (Elstree, Pinewood, Leavesden),
  2 approximate (Esher, London), 6 fictional; /api/map/works → 14; world z3 → 24
  clusters over 63 points; and the "Login with Google" button is enabled again,
  which is the visible proof the browser Supabase client initialises.
- The `Deploy production` workflow FAILED twice first: its GitHub secrets were
  never set, so it ran `vercel pull --token=""` and stopped immediately.
  `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are now set (identifiers, not
  credentials). **`VERCEL_TOKEN` is still missing** — minting and storing a
  credential is the owner's call, not the agent's.
- **Resolved same day**: the owner minted and stored VERCEL_TOKEN, and the workflow
  then ran GREEN end to end (all six steps) — the CI production-deploy path now
  works. The CLI path remains a fallback. Verified live afterwards: 28 map points,
  14 works, no error.
- Local Vercel CLI updated 52.0.0 → 57.0.0 (52 loops on `env add ... preview`).

## [2026-07-24] incident | Vercel env: NEXT_PUBLIC_SUPABASE_* were sensitive, breaking the client

- Symptom: the graph endpoints returned 502 `graph_query_failed` on every
  deployment, while the same RPCs returned correct data when called directly with
  either key type — so the database was never the problem.
- **Root cause**: both `NEXT_PUBLIC_SUPABASE_URL` and `..._ANON_KEY` were stored as
  **sensitive** variables (the `vercel env add` default on Production and Preview).
  Vercel withholds sensitive values from the BUILD, so a `NEXT_PUBLIC_*` value is
  never inlined into the client bundle — a scan of every production chunk found no
  `supabase.co` at all, meaning the browser client was `null` and login / cloud
  library were quietly dead. Server routes still read `process.env` at runtime, so
  they got *something* and failed later — hence 502 instead of an honest 503.
- Fix: removed and re-added both variables for Production, Preview and Development
  with `--no-sensitive`. Verified with `vercel env pull` that the values are now
  readable (a sensitive value pulls back EMPTY — that is how the cause was found).
- Two CLI traps hit on the way, both recorded in [[deployment-pipeline]]:
  `vercel env rm NAME preview` removed the variable for **all** environments (one
  entry covered both), and CLI 52 loops on `env add ... preview` even with the
  flags it suggests — `npx vercel@latest` works.
- Verified on a fresh preview deployment: /api/map/points → 28 London points, 3
  studios, 6 fictional; /api/map/works → 14; and the "Login with Google" button is
  enabled again, which is the visible proof the browser client initialises.
- **Production still runs the pre-fix build.** Its variables are correct now, but
  the value is baked at build time, so it needs a manual production deploy
  (workflow_dispatch + confirm_production) — deliberately a human decision.

## [2026-07-24] update | Step 3 slice 3c — layer filters + KNN nearest, #94 closed

- PR #106 merged. The graph layer is now navigable, not just visible.
- Migration: remote_points (KNN via the geography <-> operator — the FIRST thing
  that actually uses the centroid GiST index, since the viewport filter
  deliberately moved to lat/lng) and map_works (works that HAVE a mappable place).
- /api/map/points returns `nearest` when and ONLY when the viewport is empty: a
  blank map reads as "there is nothing", when the honest answer is "nothing HERE
  — the nearest is 141 km that way". A populated viewport never pays for it.
- GET /api/map/works: real options for the "this work" filter. A work whose only
  places are fictional (The Lord of the Rings) is correctly absent — 14 of 15.
- UI: kind chips + a work selector that CASCADES from the kind filter (changing
  the kind clears a now-orphaned selection) + clickable nearest hints.
- parseKindsParam extracted so both endpoints share one validation and the same
  refusal to silently widen.
- Verified live: works=14 (Skyfall 16, 28 Days Later 13, HP 10); kinds=book →
  Mrs Dalloway + Oliver Twist; empty view near Manchester → Lake District 141 km;
  Skyfall in London → 8 points incl. Pinewood; kinds=nope → 400. In the browser
  the work list narrows 14 → 2 on the Book chip and the nearest hint renders.
- Applied the overload lesson: verified each function has exactly ONE signature
  after applying.
- 239/239 green. **Open for the owner**: the Vercel PREVIEW env still returns 502
  graph_query_failed for the graph endpoints; the DB is sound (RPCs return
  correct data for both key types), so its NEXT_PUBLIC_SUPABASE_* point elsewhere.

## [2026-07-24] update | Step 3 slice 3b — grounded-places layer on the map

- PR #105 merged. The content graph is now ON the map, not just in JSON.
- **Scope decision**: the layer is ADDITIVE, behind a toggle. The graph holds 70
  places from 15 works while /api/locations answers for any city via live
  Wikidata, so switching the map over wholesale (as #94 words it) would make
  searching e.g. Paris come back nearly empty — a demo-path regression.
- app/lib/map-layer.mjs (pure, 13 tests): BADGE_STYLES / pointStyle / clusterStyle
  / viewportQuery / pointSummary. What a pin MEANS is decided and tested here,
  not inside a Leaflet callback.
- app/components/GraphLayer.jsx: CircleMarkers on a shared L.canvas() renderer,
  debounced refetch, AbortController, cluster bubbles that zoom in on click.
- SceneMapApp: "Grounded places" toggle, a legend per badge, and the
  "Fictional — not on the map" strip.
- Honesty in the styling: filmed-here / studio / a book's setting / a city
  centroid are four different claims. Colour alone can't carry it (exact and
  approximate share the amber), so approximate is ALSO larger, dashed and faded —
  it must read as a region, never a doorstep. A test pins that.
- Cluster bubbles use a LOG scale: a test caught that sqrt*3 saturated at ~45,
  so clusters of 50 and 5000 were drawn identically.
- **Fixed the long-standing Leaflet crash** ([[nearby-geolocation]] recorded it as
  an environment gotcha): animated moves interpolate through the container size,
  and at zero size that yields NaN → Leaflet throws → the WHOLE app fell into the
  error boundary over an animation nobody could see. moveMap() degrades to a
  non-animated setView; fitBounds guarded the same way.
- **Stale RPC overloads**: `create or replace function` only replaces an EXACT
  signature, so adding p_kinds/p_limit/p_max_clusters in the fixes migration
  created OVERLOADS and left the ORIGINAL buggy functions live and callable
  (geography bbox, no evidence gate, antimeridian inversion) — and made the call
  ambiguous for PostgREST. Dropped. Changing a parameter list is a DROP, not a
  replace; verify with pg_get_function_identity_arguments after applying.
- /api/map/points now returns a coarse reason code (graph_auth_rejected /
  graph_schema_mismatch / graph_query_failed) so a deployment failure is
  diagnosable without exposing the key or the SQL.
- **Open issue for the owner**: the Vercel PREVIEW deployment returns 502
  `graph_query_failed` for /api/map/points, while the same RPCs return correct
  data when called directly with either the legacy anon key or the publishable
  key. The database side is sound, so the preview environment's
  NEXT_PUBLIC_SUPABASE_URL / ANON_KEY appear to point elsewhere. Values are not
  readable from here — needs checking in Vercel project settings.
- Verification limit: the canvas pins themselves were NOT visually confirmed —
  the preview pane reports a 0x0 viewport (for local AND remote URLs), so the
  map's bounds are degenerate. Needs a real browser.
- 236/236 green. Remaining in #94: layer filters wired to the UI (the API already
  takes workId/kinds) and KNN remote_points.

## [2026-07-24] update | Step 3 slice 3a — map reads from the graph + first graph data

- PR #104 merged. The map's READ path now serves the persistent graph, not live
  SPARQL: a viewport is one indexed query. Client rendering is the next slice.
- **The graph was empty**, so "read from the graph" would have blanked the map.
  Ran the Step 2 resolver over 15 verified works → 70 places / 84 links / 154
  evidence, seeded into the shared project. This is also the first real exercise
  of the resolver's write path — persisted counts match its local plan exactly.
- supabase/migrations/20260724000000_map_points_rpc.sql + ...010000_map_points_fixes.sql:
  map_points_in_view / map_clusters_in_view / fictional_places / place_is_mappable.
- app/lib/map-points.mjs (pure parseMapQuery / buildMapResponse / pointBadge) +
  app/api/map/points/route.js (DI factory, anon client — the graph is public-read).
  Points carry place_class, confidence, precision, shot_on_set and a badge
  (exact / approximate / studio / narrative) so the UI can be honest.
- Verified live in a browser: world z3 → 24 clusters over 63 points; London z13 →
  28 points; Pinewood/Elstree/Leavesden badged studio; London & Esher badged
  approximate; all six Tolkien realms in the fictional strip, never a pin.
- **Bugs found (2 by tests, 11 by adversarial review, all fixed).** The critical
  one: the viewport filtered on `places.centroid`, which NO write path fills —
  the resolver's upsert sets only lat/lng, so any place written after the seed had
  centroid NULL, and `NULL && box` is NULL, not false → a fully evidenced point
  vanished behind a 200. centroid is now a GENERATED column and the bbox filters
  on lat/lng. Also: no evidence requirement in SQL (now mirrors
  grounding.isPublishable incl. agrees=false); least/greatest inverted an
  antimeridian-crossing viewport into its complement; invalid workId/kinds failed
  OPEN to the whole graph; bbox in geography space (a world envelope is
  degenerate, st_area=0 → zoom-out showed zero points); and `Number(null) === 0`
  coercing a missing bbox and a coordinate-less row to a valid 0,0.
- 19 tests added, 222/222 green. Remaining in #94: canvas + supercluster client,
  layers, fictional strip in the UI.

## [2026-07-24] update | Step 2 — Location Resolution Engine (Stage 0 + 1), #93 closed

- PR #103 merged. The spine: an imported work now becomes map-ready places.
  Stage 0 reads Wikidata location claims (P915 film/series, P840 book), Stage 1
  classifies by P31→P279* ancestry, POST /api/resolve write-throughs to
  places / work_place_links / place_evidence.
- app/lib/location-resolver.mjs: pure classifyPlace / buildResolutionPlan /
  missingEvidenceRows + injectable fetchWikidataEntities / fetchTypeGraph /
  resolveWorkPlaces. Deliberately does NOT use normalizeWikidataLocations —
  it drops coordinate-less rows ([[wikidata]]), which would delete every
  fictional place. Reads the entity primitives instead.
- location-search.mjs: typeAncestry extracted from workMatchesTypeGraph (now a
  thin wrapper); entityText/entityCoordinate exported; entityCoordinate rejects
  non-Earth globes and keeps Wikidata's own P625 precision.
- **The spec was wrong**: issue #93 and ARCHITECTURE said studio→Q1107679, which
  is *animation studio*. Verified live — real studios (Pinewood, Shepperton,
  Cinecittà, Babelsberg) are P31→Q375336; Q21550789 is the separate building
  sense that does not reach it. With the spec value a soundstage shoot would have
  been recorded as a real street. ARCHITECTURE.md corrected.
- Classification never uses names: isStudioLocation is a name regex and only
  raises a QA flag ([[film-imagery]] uses it for its own purpose).
- Built via a judge panel (3 designs × 3 judges, winner "entity-primitives"
  33.7/40) then a 4-lens adversarial review: 22 findings reviewed, **19
  confirmed and all fixed**, incl. 4 critical — non-Earth P625 pinned on Earth
  (the Moon is 0,0 → Null Island; Mars lng 0..360 → batch-wide 502), duplicate
  location statements → Postgres cardinality violation, type-graph node budget
  failing OPEN (severed fiction chain → real pin), and shared-place class
  depending on iteration order.
- Live-validated on 5 real works: 24 places / 24 links / 48 evidence; Leavesden →
  studio_interior with its own coords; 9 fictional places all coordinate-free;
  Moon/Mars targets refused. 43 tests, 203/203 green.
- Next: Step 3 (#94) render the map from the graph; Stages 2-4 stay deferred.

## [2026-07-23] update | Step 1 slice 1c — external-id → Wikidata QID cross-walk

- #92 (Step 1): the id cross-walk. PR #102 merged. The join Step 2 (#93 Location
  Resolution Engine) needs to turn an imported work into its Wikidata entity.
- app/lib/connectors/wikidata-crosswalk.mjs: pure builders/parser
  (crosswalkCandidates / buildCrosswalkSparql / parseCrosswalkResults /
  resolveWorkQids) + injectable fetch wrapper (crosswalkWikidataIds), same
  pure/route split as letterboxd-rss.mjs. Reuses wikidataId / isWikidataId from
  [[wikidata]] (location-search.mjs). One batched SPARQL VALUES query per set.
- Properties live-verified vs query.wikidata.org: P4947 TMDb movie / P4983 TV,
  P345 IMDb, P212/P957 ISBN-13/10, P436 release group / P4404 recording.
  works.kind picks the property (tmdb never misread as a TV id).
- Injection defense: property from a hard-coded allow-list only; each value
  passes a per-type format regex then isSparqlLiteralSafe (rejects
  quote/backslash/control), re-checked in the builder. resolveWorkQids is
  deterministic (smallest QID) and flags conflicts (ISBN edition splits, id
  disagreement). ISBN is best-effort (Wikidata hyphenation + sparse coverage).
- Built research-first + adversarial-review workflow: a research fan-out
  (repo conventions + live-verified properties), then a 3-lens review whose 6
  confirmed findings (1 correctness + 5 mutation-verified coverage) were all
  fixed before merge. 19 module tests, 160/160 suite green.
- Remaining in #92: connectors (Trakt / Kinopoisk / Goodreads / Open Library /
  Last.fm) reuse this cross-walk; then #93 wires works → Wikidata → locations.

## [2026-07-23] update | Step 1 slice 1b — Letterboxd import route (write layer)

- #92 (Step 1): the write path on top of slice 1a's pure core. PR #101 merged.
- app/api/import/letterboxd/route.js: POST fetches a member's RSS with a browser
  User-Agent (bare server request 403s), parses watched films, upserts canonical
  works by tmdb_id (service role → shared graph) + this user's user_library_items
  (auth.uid()). DI-factory createLetterboxdImportHandler (env / fetchImpl /
  resolveUserId / createWriter) mirrors createFilmImageHandler — 8 handler tests,
  no live Supabase or network. 141/141 green.
- Migration works_unique_ids: plain (non-partial) unique indexes on
  works(tmdb_id/imdb_id/isbn/mbid) so imports upsert-or-get by external id.
  Non-partial because a partial index can't be an `on conflict (col)` target.
  Applied to the shared project.
- Not browser-verifiable: needs SUPABASE_SERVICE_ROLE_KEY + a signed-in user,
  so the DB-write path runs only in prod (like OpenAI/TMDB) — [[deployment-pipeline]].
- Remaining in #92: id cross-walk (tmdb/imdb/isbn/mbid → wikidata_id) for
  connectors without a ready tmdb id, then Trakt / Kinopoisk / Goodreads /
  Open Library / Last.fm connectors.

## [2026-07-23] update | Step 1 slice 1a — import funnel core (Letterboxd RSS)

- Started #92 (Step 1): pure, reusable core of the import funnel. PR #100 merged.
- app/lib/connectors/letterboxd-rss.mjs: parse letterboxd.com/{handle}/rss/ →
  watched films; each carries a ready tmdb:movieId so it joins straight to the
  TMDB-keyed graph, no id cross-walk needed. Handle validation + feed-URL builder.
- app/lib/content-graph.mjs: normalizeWorkTitle (NFKD + strip accents so
  "Amélie"=="Amelie" — stricter than media-library's), works-row mapping,
  dedup by natural key, per-user library items. 12 tests, 133/133 green.
- Remaining in #92 (noted on the issue): /api/import/letterboxd route
  (service-role write + user auth, DI handler) + id cross-walk + more connectors.

## [2026-07-23] update | content_graph migration applied + geo.mjs consolidation

- Applied the content_graph migration to the shared Supabase (owner-authorized):
  8 graph tables (creators/works/work_creators/places/scenes/work_place_links/
  place_evidence/user_library_items) with RLS. Verified live: anon reads the graph
  (200), anon write blocked (42501), per-user library isolated. Dropped the empty
  superseded locations/scenes. Step 0 fully done → #91 closed, Steps 1-2 unblocked.
  Advisory: spatial_ref_sys (PostGIS system table, 8500 SRID rows) has RLS off —
  expected and must stay off (enabling it breaks spatial functions).
- Consolidated the haversine (×4) + Earth radius (×4) + coord validators (×3) into
  one pure app/lib/geo.mjs (PR #99, closes #80). Bit-identical delegation → existing
  exact-value tests pass unchanged; +6 geo tests. 121/121 tests, build green.

## [2026-07-23] update | Step 0 merged + cloud-save race fixed (by priority)

- Merged PR #89 (Step 0): grounding.mjs + content_graph migration file + 13 tests
  now on main. NOTE: the migration is NOT yet applied to the shared Supabase DB —
  that remains the gated action to unblock backbone Steps 1-2 (issue #91).
- Fixed #83 (★★★★ real data-loss bug, PR #98): the debounced cloud-library save
  cancelled the pending timeout but not the in-flight request, so a stale save
  could overwrite a newer one. New pure app/lib/coalesce.mjs serializes saves
  (last-write-wins, no overlap), 4 unit tests. 115/115 tests, build green.
- Next parallel-safe ★★★★ items available without the DB migration: #80 (geo.mjs),
  #60 (attribution component).

## [2026-07-23] decision | Grand architecture — grounded content-to-map engine

- 5-architect + skeptic design pass → ARCHITECTURE.md (root): the full-scope
  engine where every point is evidence-backed, never invented; studio/street/
  fiction distinguished at the schema level.
- Locked 5 foundational decisions (resolve the data-model divergence): one
  canonical `places` + `work_place_links` + a single `place_evidence` ledger; one
  `place_class` enum (P31 BFS, not name-match); one `grounding.mjs` confidence
  fn + threshold; globally-shared graph ("my library" = JOIN via
  user_library_items, service_role writes); persisted-first runtime.
- Location Resolution Engine spine: cheap→expensive cascade (Wikidata canonical +
  P31 classification = MVP; web_search + GeoCLIP + Mapillary/Commons grounding =
  one deferred growth module). Free-tier-first; only web_search + vision/TTS cost.
- ROADMAP: added Phase F · Foundation (Steps 0-6). Created architecture epics
  #90-#97. Step 0 shipped as PR #89 (grounding.mjs + content_graph migration +
  13 tests; migration is review-only, applying to shared DB is a gated step).

## [2026-07-22] update | Code audit + render-crash hardening

- Confirmed no unmerged work: 28 PRs merged, 0 open; the many "ahead" remote
  branches are stale post-merge branches (history rewrite artifact), each maps
  to a merged PR, no code file on any branch is missing from main.
- Ran a multi-dimension code audit (dead code, duplication, correctness,
  simplification, test gaps) with adversarial per-finding verification: 28
  confirmed, 3 rejected. Baseline 98/98 tests green.
- Fixed + merged the correctness cluster (PR #78): onError no longer removes
  React-managed DOM nodes (broken URLs tracked in state), out-of-range
  coordinates filtered, `flyTo` guarded by `isLatLng`, and a root
  `app/error.jsx` error boundary turns any uncaught client throw into a
  recoverable "Try again" card instead of a blank SPA (verified in browser).
- Fixed + merged hygiene (PR #79): removed 8 dead exports; pinned cities/
  locations to `runtime="nodejs"` (locations uses node:crypto transitively).
- Filed the remaining audit findings as Russian tech-debt issues #80–#88
  (haversine ×4 → geo.mjs, OpenAI-route helper, buildTimedTour split,
  cloud-save race, test gaps, route dedup, etc.).
- Note: the preview pane can't render Leaflet (0-size container → flyTo NaN),
  so live map verification uses the prod site; the error boundary now covers it.

## [2026-07-22] decision | Roadmap + backlog for post-hackathon development

- Ran a 5-area competitor/approach study (imagery, AI tours, recreate-the-shot,
  exact locations, plot routes) → `wiki/sources/feature-research.md`.
- Published `ROADMAP.md`: 5 themed phases (Precision & Trust, Recreate 2.0,
  Living Imagery, AI Guide on the Move, Story Trails) + a parallel Product Polish
  track, mapped to GitHub Milestones 1–6.
- Created 34 backlog issues (#44–#77) with theme/priority/size labels, each
  attached to its phase milestone; the 4 existing MVP issues joined Phase 0.
- Closed stale kickoff/role issues #1–5. Added labels: P1/P2/P3, size-S/M/L,
  7 theme labels, roadmap.
- Legal load-bearing notes captured: Street View can't be cached (live-embed
  only), Mapillary CC BY-SA, film stills hotlink-not-archive, EXIF strip on
  upload, web geofencing is foreground-only (Wake Lock now, Capacitor later).

## [2026-07-22] update | Make Google Login visible on the main screen

- Signed-out visitors now see a prominent `Login with Google` control in the main GloryMap header; it launches Supabase OAuth directly instead of hiding authentication inside `My movies`.
- After authentication, the same control becomes `My movies` and opens the account-backed personal library.

## [2026-07-22] decision | Use GPT-5 nano for low-cost API features

- Text tour generation, web-assisted location research, and film-frame vision matching now default to `gpt-5-nano`; local environment overrides use the same model without exposing the API key.
- Location research is limited to exactly one low-context web-search call. A real request confirmed that `reasoning: low` plus a 3,000-token ceiling completes Structured Outputs, while the previous 1,400-token ceiling ended before the parsed response.
- Kept speech generation on the dedicated `gpt-4o-mini-tts` path because audio pricing and capabilities are separate from text and vision models.
- Verified 98 tests, the production build, a real structured tour, conservative vision rejection, and a real web-assisted discovery response from `gpt-5-nano`.

## [2026-07-22] decision | Ship means a complete production release

- An explicit owner command `ship` now authorizes the full release chain: scoped commit, push, PR readiness, checks, merge to `main`, production deploy, and public verification.
- Preview-only delivery is not considered shipped; production remains preview-only when the owner has not explicitly said `ship`.

## [2026-07-22] incident | Reject mismatched TMDB artwork and stale scene capabilities

- Live TMDB and GPT-5.6 Terra checks exposed two failure modes: signed location capabilities could remain stale in a public cache, and a first-pass matcher could describe the present-day reference image instead of the shortlisted film frame.
- Signed `/api/locations` responses are now private and uncached; scene matching requires photographic, logo-free evidence plus a second exact-file verification pass that receives only the shortlisted TMDB files.
- The conservative fallback is intentional: if the exact location cannot be verified, the API returns `no_high_confidence_match` and the UI shows `No verified scene match` instead of attaching unrelated artwork.
- Verified 98 tests, the production build, private `Cache-Control`, a live OpenAI/TMDB request, and the production UI at `http://localhost:3000` without exposing credentials.

## [2026-07-22] update | Described film frames per verified location

- The scene matcher now returns up to three distinct TMDB frames with the verified place name, a physical location type, and a short OpenAI Vision description; the legacy top-level `image_url` remains for compatibility.
- Streets, venues, buildings, and landscapes still require high-confidence visual evidence. An explicitly named studio can group representative production frames, but every description must state that the exact set or soundstage is not visually verified.
- The location sheet keeps the first frame in the then/now comparison and shows additional matches in a bounded gallery; no database schema or arbitrary image scraping was added.
- Verified 96 tests, the production build, desktop/mobile layout, and a clean browser console. The local environment has no TMDB credential, so a real Vision gallery still requires the configured preview or production environment.

## [2026-07-22] update | Account-backed personal libraries

- Supabase Auth adds Google and Facebook OAuth entry points to the existing Personal Library without uploading source ZIP/CSV files.
- Guest imports remain local; after login they merge with the user's device and cloud libraries and sync as a normalized JSON list protected by user-scoped RLS.
- Added the database migration, client-side sync boundary, provider setup documentation, and regression tests for cloud payload validation and user-scoped reads/writes.

## [2026-07-22] ingest | Wiki rebuilt as a knowledge graph + collections matrix

- Read the entire codebase (6 parallel readers: frontend, API, libs, tests,
  history) and rebuilt the wiki: filled in the overview, 9 entities and 7
  concepts with cross-referencing [[links]] — the repository reads like an
  Obsidian graph.
- Recorded easily forgotten facts: Supabase is created but not used at
  runtime; production deploy is manual only, through a GitHub gate; preview
  has no OPENAI_API_KEY; negative film-image responses come back as 200 + reason.
- Added sources/personal-collections-matrix.md: live-verified research on
  "where to read personal collections from" (Letterboxd RSS with a ready-made
  tmdb-ID, Trakt without OAuth, Kinopoisk/MyShows for RU, Goodreads RSS; Spotify
  dev mode — 5 users) + ideas about film frames (IMDb is off-limits; fallback is
   TMDB episode stills, Fanart.tv) and "paste your Letterboxd handle". Owner's
   decision: ideas for now, not in progress.

## [2026-07-22] update | Devpost Codex and GPT-5.6 evidence

- Supplemented the product-focused README with the Devpost-required setup, judge test path, and evidence-backed descriptions of Codex and GPT-5.6 usage.
- Clarified which collection integrations work today versus the longer-term product vision and switched the demo link to the stable production alias.
- Verified the claims against current routes and dependencies, then ran all 89 tests, a successful production build, and a clean documentation secret scan.

## [2026-07-22] update | Retire alternate-agent references

- GitHub permissions and Contributors API confirmed that the retired agent is neither a collaborator nor a listed contributor.
- Removed its current references from tracked files and retired its already-merged remote branch.
- Historical commit trailers were left intact because rewriting shared history would require a disruptive force-push and is unnecessary for the current contributor list.

## [2026-07-22] update | README architecture and Codex development story

- The README now includes reproducible local-run instructions and a verification path for evaluating the project.
- Documented in detail the confirmed full-stack architecture, privacy boundaries, the API and external sources, the branch-based GitHub process, and the staging/production Actions.
- The Codex and GPT-5.6 section separates the collaborative development process from the model's use inside GloryMap features; video-creation requirements were intentionally not added.

## [2026-07-22] update | Product-only public README

- The README focuses on user pain, GloryMap's value, and the path from a personal collection to a real route.
- Removed internal preparation elements: the elevator-pitch label, import format, test metrics, API/env, local development, and the agent process.
- The key feature is called out separately: films, series, and books from personal collections appear on the map when there are meaningful locations in the selected city.

## [2026-07-22] update | Emotional story-first elevator pitch

- The README pitch now opens with an emotional connection to the films, series, and books that accompany a person for years.
- The product vision describes a single personal map for libraries from Letterboxd, Netflix, Prime Video, Goodreads, and Kindle, without reducing the idea to the mechanics of a single ZIP import.

## [2026-07-22] update | Product README and elevator pitch

- The root README was changed from a hackathon starter kit description to an English-language GloryMap product page.
- Added an elevator pitch, live demo, a verifiable demo flow, features, architecture, privacy model, API/env reference, limitations, and roadmap.
- The text uses confirmed results from Letterboxd browser checks and does not promise city coverage that is absent from the sources.

## [2026-07-22] update | Restore scene-matcher candidate recall

- Production checks reproduced `no_high_confidence_match` across three current London film/location pairs; the request pipeline and signed capabilities were healthy.
- The matcher inspected only the six most popular TMDB backdrops even when a plausible location frame appeared later in the gallery, so the relevant image could never reach vision.
- Expanded the same single low-detail vision request to a bounded 24 candidates without weakening the high-confidence gate; the matcher now uses the canonical Wikidata relationship while allowing a present-day exterior and filmed interior to be different views of the same place.
- Versioned the matcher URL to bypass stale cached no-match responses and added a regression for a verified match at index 10.
- Verified `npm test` (89/89), the production build, and `git diff --check` on current `main`.

## [2026-07-22] update | Letterboxd ZIP drives the personal map

- The Personal Library accepts a full Letterboxd ZIP and reads the root `watched.csv` and `ratings.csv` locally; the archive and the list are not sent to the server.
- After import, the map automatically shows the intersection of the personal library with the available locations of the selected city; the filter can be turned off in the library panel.
- A real export imported 2,422 films and 2,407 ratings; the current London data contained 3 films and 6 locations.
- The ZIP is limited to 25 MB and the extracted CSVs to 10 MB; standalone Letterboxd/IMDb CSVs still work. `npm test` (62/62) and `npm run build` are green.

## [2026-07-21] update | Location-specific film scene matching

- Replaced the per-film top-backdrop lookup with a conservative OpenAI Vision comparison between a canonical Wikidata place photo and up to six TMDB candidates.
- A film image is now returned only for a high-confidence visual match; uncertain, failed, or unconfigured matches render an honest placeholder and keep the exact Bing Images fallback.
- Client and CDN caches are keyed by the verified film-location pair, so two locations from the same film no longer share a result; canonical redirects, server-issued capabilities, and per-client origin limits protect the paid matcher.
- Verified 87 unit/API tests, a live canonical Wikidata pair, the production build, the no-secret API response, and the live-data card in Chromium. A live vision call still requires the server-only TMDB and OpenAI keys in the deployment.

## [2026-07-21] update | Map drag refreshes visible locations

- Leaflet previously changed only its internal viewport on drag, while `/api/locations` still depended on the unchanged React city center, so no follow-up request was made.
- A user `dragend` now updates a separate browse center and viewport-sized radius, cancels stale nearby requests, and reloads pins without reacting to programmatic marker or route movement.
- Viewport refresh preserves an existing route and keeps the current location selected only when it remains in the new result set.
- Verified on current `main` with 64 tests, the production build, and a real production-mode browser: the initial 10-place request was followed by exactly one changed-center request returning 9 places; the `1 / 5` route remained and the console had no errors.

## [2026-07-21] decision | Staging and production deployment gates

- A merged pull request to `main` creates a Vercel Preview tracked by the GitHub `staging` environment.
- Production deployment is manual, requires explicit confirmation, and runs through the GitHub `production` environment approval boundary.
- Both workflows deploy prebuilt artifacts with `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; no credentials are stored in the repository.

## [2026-07-21] incident | Sparse-location research rejected before web search

- Production testing after PR #32 found that sparse book results stayed at one coarse Wikidata place because `/api/locations/discover` returned `502` before running web search.
- The discovery Zod schema emitted unsupported JSON Schema `format: "uri"`; OpenAI Structured Outputs supports selected formats but not `uri`.
- Kept the source URL as a bounded string in the model schema while retaining the stricter application check that only exact URLs from consulted web-search sources are accepted. Added a regression test and verified 58 tests plus the production build locally.
- Real production browser checks returned 13 `Mission: Impossible – Fallout` locations in Paris and three `The Crown` locations in Greater London, with relation descriptions and source links. The preview environment has no `OPENAI_API_KEY`, so the sparse-result research fix requires one post-merge production check.

## [2026-07-21] update | Filter unresolved Wikidata labels

- Excluded records whose work or place label begins with an unresolved Wikidata QID, including television-series (`Q6769811`) entries without a human-readable name.

## [2026-07-21] update | Multi-place story search across cities

- Fixed the Wikidata pair limit so duplicate release/image rows no longer consume the result window before distinct work-location pairs are selected.
- Added city-bounds-aware title search for films, series, and books. Known works use the faster Wikidata entity API; sparse results can be supplemented only by in-city, directly cited web research.
- Location cards now explain whether a place is a filming location or story setting, include the place description, and link to the supporting Wikidata or research source.
- Rebased onto current `main` while preserving nearby geolocation, timed tours, voice guide, TMDB imagery, recreate-the-shot, and the GloryMap brand. Verified 57 tests, the production build, 16 nearby London places, and 13 `Mission: Impossible – Fallout` places in Paris in a real browser.

## [2026-07-21] decision | Product renamed to GloryMap

- Renamed the active product brand, page metadata, accessibility copy and routing User-Agent from SceneMap to GloryMap.
- Preserved historical logs, raw context, internal component names and existing `scenemap-*` localStorage keys for traceability and backward compatibility.

## [2026-07-21] update | Correct image PR synced with current main

- Resolved PR #24 conflicts with the books/series, nearby-location, timed-tour, voice-guide, and recreate-the-shot changes from current `main` without rewriting branch history.
- Preserved TMDB IDs only for films, HTTPS Commons place images, and the balanced Film/Series/Book API response.
- Recreate-the-shot opens only with a real reference image; the combined branch is covered by the final PR checks.

## [2026-07-21] update | Nearby search integrated with timed and voice tours

- Integrated current `main` and its #17 nearby-radius flow while preserving city/geolocation tour planning, books and series, recreate-the-shot, real walking routes, and OpenAI MP3 narration.
- Verified the resolved component with 38 unit tests, a production build, and a real browser flow: geolocation found National Gallery at 101 m, the timed planner built five stops at 4.7 km / 63 min, and the voice guide played the generated narration.

## [2026-07-21] update | Timed nearby tours and OpenAI voice guide

- Added 30/60/120-minute tour planning from a searched city or browser geolocation. The deterministic planner combines duplicate works at one physical place, chooses 3–5 nearby stops, and accepts only walking-router results within the 15% budget tolerance.
- `Start tour` transfers the planned stops into the existing route and rebuilds them through `/api/route`; the route handler now supports both merged request contracts and returns normalized plus legacy metrics.
- AI adds short original stories when available; verified location descriptions remain a deterministic fallback when `OPENAI_API_KEY` or the AI service is unavailable.
- Added server-side `gpt-4o-mini-tts` MP3 narration with Play, Pause/Resume, Stop, spoiler-free copy, high-quality `marin` and `cedar` voices, and automatic stop on location changes. `OPENAI_API_KEY` never reaches the browser.
- Verified with 30 unit tests, a production build, real `gpt-5.6-terra` timed tours, a real 89 KB OpenAI MP3, Play/Pause/Resume/Stop, automatic stop on location change, a post-merge 5-stop route (4.7 km, 63 min), deterministic AI-off fallback, geolocation, and a clean-console normal browser flow.

## [2026-07-21] update | Books and series in the live map

- Expanded the Wikidata endpoint to return films and television series by filming location (`P915`), plus books by narrative location (`P840`), all restricted to the selected map area.
- The map balances returned work types and labels every result, map pin, list entry, and detail card as Film, Series, or Book.

## [2026-07-21] update | Local recreate-the-shot demo

- Added the issue #21 mobile flow from each location card: local photo upload, adjustable overlay, then/now comparison, reset, and repeat upload.
- User images remain browser-only object URLs; the flow has no upload request or persistent storage.
- Verified the complete flow at 390 px in Chromium, including a long live-location title, keyboard opacity control, reset/re-upload, zero mutating network requests, all unit tests, and a production build.

## [2026-07-21] update | Correct film and place image sources

- Stopped reusing the Wikimedia place photo as the film image in live location cards; missing film media now renders an explicit placeholder instead of a misleading duplicate.
- Added Wikidata TMDB IDs and a server-only cached TMDB image endpoint, while keeping Commons images on HTTPS for the current-place side of the comparison.
- Verified seven unit tests, the production build, the no-token fallback in a real browser, and the distinct film/place image flow with an intercepted TMDB response.

## [2026-07-21] update | AI-guided film tour

- Added server-only `POST /api/tour`: OpenAI Responses API with `gpt-5.6-terra` returns an English tour through Structured Outputs.
- The model receives only the selected film and up to five current verified SceneMap locations, whether live Wikidata or fallback; schema and post-validation reject unknown, missing, or duplicated stops.
- The English-only UI shows the AI story and builds a real walking route in the suggested order while preserving city search, location image search, and the manual 3–5 stop route.
- Verified with 9 unit tests, a production build, a real API call, and browser AI/manual paths with a clean console.

## [2026-07-21] update | English location image search integrated

- Integrated PR #13 on top of the personal-library branch while preserving the English-only UI contract.
- Location cards now open a focused Bing Images query built from the film, place and scene without API keys.

## [2026-07-21] update | English-only UI review fix

- Translated all user-facing copy, accessibility labels, loading text, metadata, and API error messages under `app/` to English in response to PR #13 review feedback.
- Verified zero Cyrillic strings remain under `app/`, all four unit tests pass, the production build succeeds, and the live-data card plus image-search link work in an isolated browser session.

## [2026-07-21] update | Location image search

- Added a "Find scenes filmed here" action to every location card; it builds a focused image-search query from the film, place, and scene and opens Bing Images in a new tab.
- Kept the demo independent from API keys and embedded third-party results; verified the production build, unit tests, two location-specific queries, and the external search flow in a real browser.

## [2026-07-21] update | Letterboxd and IMDb personal movie library

- Replaced title-only connector matching with schema-aware Letterboxd and IMDb CSV parsing for titles, years, personal ratings, dates, URLs and IMDb IDs.
- Imports from both services merge into one searchable library, deduplicate matching movies and persist locally without account passwords or server uploads.
- Synced current `origin/main`, restored English-only app copy, passed 7 tests and `next build`, and verified an IMDb import with two persisted movies in a real browser.
- The live Wikidata request took 25–43 seconds during browser smoke; the deterministic fallback map remained interactive while it loaded.

## [2026-07-21] update | City search for the live film map

- Added a city-search control with London as the default. It geocodes only a submitted city query, recenters the map, and reloads nearby Wikidata filming locations.
- The city endpoint uses server-side cached Nominatim requests with an identifying User-Agent; no user location or search history is stored.
- Verified the flow by switching the local app from London to Paris and receiving Paris-area film locations.

## [2026-07-21] decision | IMDb integration deferred

- Removed the Check-ins CSV import and IMDb-specific API filtering. IMDb does not offer a supported personal-account API, and the project does not use scraping.

## [2026-07-21] update | SceneMap frontend consumes live locations API

- The map now fetches `/api/locations` on load for the London viewport and replaces its demo pins, film chips, location list, card, and route inputs with Wikidata results.
- The static London set remains a client-side fallback when the upstream request fails, so the MVP demo path stays available without persisting data.
- Verified visually in the local app: live film locations and Commons imagery render in the map and location card.

## [2026-07-21] update | Live Wikidata film-location API

- Added `GET /api/locations` for SceneMap. It requests Wikidata directly using the visible map center (`lat`, `lng`), `radius` in kilometres, and `limit`; defaults target London.
- The response normalizes film/location Wikidata IDs, labels, year, coordinates, and Commons image URL. Results are deduplicated per film-location pair and HTTP-cached for one hour.
- No Wikidata data is persisted in Supabase; the endpoint was verified with a live London request returning HTTP 200 and three coordinate-bearing locations.

## [2026-07-21] update | Real walking routes

- Added a server-side proxy to the public OpenStreetMap foot-routing service with validated coordinates, an 8-second timeout, and a clearly labeled straight-line fallback.
- The map now fits and draws the returned street geometry; the route summary uses router distance and duration and includes source attribution.
- Verified with 4 unit tests, a production build, a live API request, and the browser flow from 3 selected stops to a 13.1 km / 174 min London walking route.

## [2026-07-21] incident | First Vercel deploy targeted production

- The `feature/scenemap-skeleton` branch was pushed at commit `dd17ac7`; local and Vercel builds are green.
- The first `vercel deploy --yes` after creating the project unexpectedly got the `production` target even though the command ran without `--prod`; the deployment is Ready and returns HTTP 200 at `https://codex-hackathon-starter-lac.vercel.app`.
- The GitHub Login Connection in Vercel is not configured, so the automatic Git integration did not connect; the manual CLI deploy worked. An explicit `--target=preview` for new projects was added to the guardrails.

## [2026-07-21] update | SceneMap skeleton slice 1

- Recorded the brief in `Context/brief-scenemap-design.md` and filled in the "Project" block in `AGENTS.md`.
- Assembled the first MVP slice: a dark Leaflet map of London, 10 hardcoded film-location pins, a location card, a list of points, and a local route line after adding 3 stops.
- The Supabase schema and tables were not created; the next slice is the data contract + seed/API.
## [2026-07-21] update | Codebase mapped for GSD initialization

- Created the seven reference documents in `.planning/codebase/`.
- Verified that every document is substantive and contains no detected secret patterns.
- Mapping commit: `734d97e` on `feature/gsd-project-setup`.
