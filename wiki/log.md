# Wiki Log

Append-only, newest-first. One entry per meaningful operation.
Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | <short title>`

Tip: `grep "^## \[" log.md | head -20` shows recent activity.

---

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
