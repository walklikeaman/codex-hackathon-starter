# 🎬 GloryMap

**Turn the stories you love into places you can actually visit.**

GloryMap transforms your personal film library into an interactive map of real filming locations and story settings. Import a Letterboxd export, pick a city, discover which of your movies were filmed nearby, and build a walk that takes you from one scene to the next.

[🌍 Open the live demo](https://codex-hackathon-starter.vercel.app)

## ⚡ The elevator pitch

Every day, we spend hours inside stories. Some films stay with us for life. Some series become companions we follow for ten years. Some books describe places so vividly that they begin to feel familiar before we have ever been there.

GloryMap turns those emotional connections into real journeys. Our long-term vision is to bring together favorites from services such as Letterboxd, Netflix, Prime Video, Goodreads, and Kindle, then place their filming locations and story settings on one personal map. Today, the working product imports Letterboxd and IMDb files and supports title search for films, series, and books.

Choose a city and GloryMap shows you the places connected to the stories you already love. Revisit the scene, compare then and now, listen to its story, save the places you want to visit, and build a walking route through several meaningful locations.

GloryMap does not give you another generic list of tourist attractions. It helps you visit places that already mean something to you.

## ✨ What you can do

- 📦 **Import your Letterboxd archive** — upload the original ZIP without unpacking its folders. GloryMap reads `watched.csv` and `ratings.csv` locally in the browser.
- 🎞️ **Bring IMDb lists too** — standalone IMDb and Letterboxd CSV exports remain supported and are merged into one personal library.
- 🗺️ **Map your own movies** — after import, the map shows the intersection between your library and known locations in the selected city.
- 🌍 **Explore beyond London** — search for another city and the personal-library filter recalculates against the locations available there.
- 🔎 **Search films, series, and books** — discover filming locations and story settings from Wikidata, with cited research used for sparse results.
- 📍 **Open rich location cards** — see the work, relation type, address, distance, source, scene context, and “then vs now” imagery.
- 🙈 **Keep spoilers optional** — scene details stay hidden until you choose to reveal them.
- ❤️ **Save places for later** — “Want to visit” selections persist on the device.
- 🚶 **Build a real walking route** — choose 3–5 stops and get street-level distance and duration, with a safe fallback when routing is unavailable.
- ⏱️ **Plan by available time** — create 30, 60, or 120-minute tours around a city or your current position.
- 🎧 **Listen to the tour** — OpenAI narration supports spoiler-free mode and playback controls.
- 📸 **Recreate the shot** — line up your own photo with a reference frame using an overlay or side-by-side comparison.

## 🎥 The demo flow

1. Open **My movies**.
2. Choose **Letterboxd** and upload the complete export ZIP.
3. Pick a city.
4. GloryMap keeps the imported titles that have known locations in that city.
5. Open a pin to explore the scene and its source.
6. Add at least three locations.
7. Build a walking route and start the movie tour.

The current demo has been exercised with a real 2,422-film Letterboxd export. In the verified dataset, the library matched three titles and six locations in London, plus five titles and ten locations in New York. A city can correctly show zero personal matches when none of its currently available locations belong to the imported library.

## 🧠 How it works

```text
Letterboxd ZIP / IMDb CSV
          │
          ▼
 Local browser parsing ──► Personal library in localStorage
          │
          ▼
 Normalized title + year matching
          │
          ├──► Wikidata locations and source evidence
          ├──► TMDB reference imagery
          ├──► OpenStreetMap / walking router
          └──► OpenAI tour and voice narration
                         │
                         ▼
                A walkable story map
```

The archive never needs to reach the server. ZIP processing is capped at 25 MB, extracted CSV content at 10 MB, and only the two expected root files are read. Deleted, orphaned, review, and profile folders are ignored.

## 🛠️ Tech stack

| Layer | Technology |
| --- | --- |
| Web app | Next.js 15, React 19 |
| Map | Leaflet, React Leaflet, OpenStreetMap tiles |
| Location knowledge | Wikidata and cited web research |
| Film imagery | TMDB |
| Routes | Public pedestrian OSRM service with deterministic fallback |
| AI guide | OpenAI structured output and text-to-speech |
| Archive import | JSZip, local CSV parsing, `localStorage` |
| Validation | Node test runner, production builds, Playwright browser checks |
| Hosting | Vercel Preview deployments with gated production workflows |

## 🔐 Privacy by design

- Letterboxd ZIP and IMDb CSV files are parsed in the browser.
- Imported libraries and “Want to visit” choices stay in local browser storage.
- GloryMap never asks for a Letterboxd or IMDb password.
- Recreated-shot photos remain in the active browser tab and are not uploaded.
- API credentials stay in environment variables and are never committed.

Clearing site data removes the locally stored library and preferences.

## 🚀 Run it locally

### Requirements

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/walklikeaman/codex-hackathon-starter.git
cd codex-hackathon-starter
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The core map and local imports work without an OpenAI key. AI-generated tour copy and voice narration require the corresponding server-side environment variables.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Shared project data endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase anonymous key |
| `OPENAI_API_KEY` | Server-side AI tour and narration requests |
| `OPENAI_MODEL` | Structured tour generation model |
| `OPENAI_TTS_MODEL` | Text-to-speech model |

Never commit `.env.local` or a Vercel token.

## ✅ Development commands

```bash
npm run dev      # Start the local Next.js server
npm test         # Run the Node test suite
npm run build    # Create and validate a production build
npm run start    # Serve the production build locally
```

Do not run `next dev` and `next build` at the same time in one checkout: both write to `.next` and can corrupt the development manifest.

## 🧭 API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/cities` | Resolve a city and its map bounds |
| `GET /api/locations` | Find verified nearby or title-specific locations |
| `POST /api/locations/discover` | Supplement sparse results with cited research |
| `GET /api/film-image` | Select a suitable TMDB backdrop |
| `POST /api/route` | Build a pedestrian route for selected stops |
| `POST /api/tour` | Create a structured tour guide |
| `POST /api/narration` | Generate tour audio |

## 🗂️ Project structure

```text
app/
├── api/                    Route handlers for cities, locations, routes and AI
├── components/             Main map experience and voice guide
├── lib/                    Import, matching, routing and tour logic
├── globals.css             Responsive GloryMap interface
└── page.jsx                Application entry point
test/                       Node regression tests
wiki/                       Decisions, incidents and accumulated project knowledge
.github/workflows/          Gated Vercel staging and production deployments
```

## ⚠️ Honest limitations

- Location coverage depends on the quality and completeness of public source data.
- Personal-library matching currently uses normalized title and release year; alternate regional titles can still miss.
- A movie appears only when GloryMap has a usable location for the selected city.
- Route and research providers can rate-limit or time out, so the app uses clear fallbacks instead of pretending a result is exact.
- Protected film frames are not uploaded or redistributed.

## 🌱 What is next

- Better alternate-title matching for international releases
- More verified scene-level metadata and imagery
- Shareable personal tours without exposing a full library
- Broader city coverage while keeping every location traceable to a source

## 🤖 How GPT-5.6 powers GloryMap

GPT-5.6 is part of the product workflow, not a decorative chat layer.

- **Grounded location discovery:** when Wikidata coverage is sparse,
  `app/api/locations/discover/route.js` uses GPT-5.6 with OpenAI web search.
  Every returned location must be supported by a consulted source, stay inside
  the selected city boundary, preserve an exact source URL, pass a Zod
  Structured Outputs schema, and survive application-level validation.
- **Validated tour generation:** `app/api/tour/route.js` sends only verified
  locations to GPT-5.6. The model writes short original guide narration through
  Structured Outputs. Server-side checks reject missing, duplicated, unknown, or
  reordered stops; timed tours preserve the order already validated against real
  walking directions.
- **Honest supporting AI:** OpenAI vision handles conservative place-to-scene
  matching, while OpenAI text-to-speech creates optional narration. These use
  separate model paths and are not presented as GPT-5.6 features.

All Responses API calls run on server routes with `store: false`. API keys never
reach the browser, and untrusted user or source strings are treated as data
rather than instructions.

## 🧑‍💻 How Codex accelerated the build

Codex was our primary engineering environment during OpenAI Build Week. The
repository's dated commit history and primary Codex session record document that
work.

We used Codex to:

- turn one demo goal into small feature branches with explicit success criteria;
- implement the Next.js interface, API routes, validation schemas, local
  Letterboxd/IMDb import, walking planner, and OpenAI integrations;
- inspect and integrate concurrent teammate branches without losing the complete
  demo path;
- reproduce live failures against Wikidata, OpenAI Structured Outputs, TMDB, the
  walking router, and Vercel instead of guessing from local code;
- write regression tests for imports, schemas, sources, routing, tours, scene
  matching, and negative API paths;
- run the test suite, production builds, and real-browser checks after meaningful
  changes;
- record decisions and incidents in `wiki/log.md`, allowing later Codex sessions
  and teammates to reuse verified findings.

The most important decisions were collaborative: prefer traceable evidence over
plausible-looking volume, keep personal imports and photos local, validate every
AI boundary, and protect one complete end-to-end journey before expanding scope.

## 🤝 Built for OpenAI Build Week

GloryMap started as a focused hackathon idea: make one end-to-end experience feel real. The project is built with Codex-assisted engineering, a cumulative `wiki/`, explicit guardrails, and browser-verified demo loops so the repository remembers not only what changed, but why.

If you are reviewing the project, start with the [live demo](https://codex-hackathon-starter.vercel.app), import a Letterboxd ZIP, and take your movies for a walk. 🍿
