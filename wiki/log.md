# Wiki Log

Append-only, newest-first. One entry per meaningful operation.
Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | <short title>`

Tip: `grep "^## \[" log.md | head -20` shows recent activity.

---

## [2026-07-21] decision | Staging and production deployment gates

- A merged pull request to `main` creates a Vercel Preview tracked by the GitHub `staging` environment.
- Production deployment is manual, requires explicit confirmation, and runs through the GitHub `production` environment approval boundary.
- Both workflows deploy prebuilt artifacts with `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; no credentials are stored in the repository.

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

- Ветка `feature/scenemap-skeleton` запушена с commit `dd17ac7`; локальный и Vercel builds зелёные.
- Первый `vercel deploy --yes` после создания проекта неожиданно получил target `production`, хотя команда запускалась без `--prod`; deployment Ready и отвечает HTTP 200 на `https://codex-hackathon-starter-lac.vercel.app`.
- GitHub Login Connection в Vercel не настроен, поэтому автоматическая Git-интеграция не подключилась; ручной CLI deploy сработал. В guardrails добавлен явный `--target=preview` для новых проектов.

## [2026-07-21] update | SceneMap skeleton slice 1

- Зафиксирован brief в `Context/brief-scenemap-design.md` и заполнен блок «Проект» в `AGENTS.md`.
- Собран первый срез MVP: тёмная Leaflet-карта Лондона, 10 hardcoded film-location pins, карточка локации, список точек и локальная линия маршрута после добавления 3 stops.
- Supabase-схема и таблицы не создавались; следующий срез — контракт данных + seed/API.
## [2026-07-21] update | Codebase mapped for GSD initialization

- Created the seven reference documents in `.planning/codebase/`.
- Verified that every document is substantive and contains no detected secret patterns.
- Mapping commit: `734d97e` on `feature/gsd-project-setup`.
