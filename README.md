# 🎬 GloryMap

### Your favorite stories are already part of your life. GloryMap helps you step inside them.

Every day, we watch films, follow series for years, and get lost in books that stay with us long after the final scene or page. Their streets, cafés, houses, landscapes, and hidden corners begin to feel familiar—even when we have never visited them.

GloryMap turns that connection into a real journey.

[🌍 Explore the GloryMap demo](https://codex-hackathon-starter.vercel.app)

## 💭 The problem

Our taste is scattered across streaming platforms, watchlists, reading apps, ratings, and saved collections. These services are good at recommending what to watch or read next, but they rarely help us experience the stories we already love in the real world.

Traditional travel apps have the opposite problem: they show popular attractions, not the places that carry personal meaning for us.

Someone who grew up with a ten-season series should be able to visit its most memorable locations. A reader should be able to walk through the setting of a favorite novel. A film lover should be able to turn a weekend in a new city into a route through scenes they know by heart.

## ✨ The GloryMap experience

GloryMap is built to bring your favorite films, series, and books together and place their real-world locations on one personal map.

Today, the working product imports Letterboxd ZIP exports and Letterboxd or IMDb CSV files, while title search discovers locations for films, series, and books. Direct connectors for streaming and reading services such as Netflix, Prime Video, Disney+, Goodreads, and Kindle are part of the longer-term vision. Choose a city or use your current location to see which available stories have meaningful places nearby.

Instead of asking, “What are the top tourist attractions here?”, GloryMap asks a better question:

> **Which places in this city already mean something to you?**

## 🗺️ Your collections, on the map

Your personal library is at the heart of GloryMap.

- 🎞️ **Films from your collections** become filming locations, recognizable scenes, and real places you can visit.
- 📺 **Series you followed for years** become a map of recurring homes, streets, landmarks, and moments.
- 📚 **Books from your reading collections** become story settings and places connected to the worlds you imagined.
- 🌍 **Every city becomes personal** because the map is filtered through your own taste rather than a generic popularity ranking.

When you change cities, GloryMap recalculates the map and shows the titles from your collections that have known locations there. If a story has several places in the area, they appear together—ready to become a route.

## 🌟 What you can do

### Discover meaningful places

Explore filming locations and story settings connected to your favorite films, series, and books. Search by city, title, or your current position.

### Understand why each place matters

Open a location card to see the work, scene, relationship to the story, address, distance, imagery, and supporting source. Spoiler-sensitive details stay hidden until you choose to reveal them.

### Compare the story with the real world

See a reference from the story alongside the place today. Use **Recreate the shot** to line up your own photo with the original composition.

### Build a personal story walk

Add several places and turn them into a real pedestrian route. GloryMap calculates walking distance and duration so the experience works outside the browser, not only on the map.

### Plan around your day

Choose how much time you have—30, 60, or 120 minutes—and let GloryMap create a tour around your location and the stories you care about.

### Listen as you explore

Use the AI voice guide to hear the context behind each stop while you walk. Spoiler-free narration is available when you want the atmosphere without revealing the plot.

### Save the places that matter

Mark locations you want to visit and keep building a personal travel wishlist inspired by the stories you love.

## 🚶 From collection to journey

```text
Your films, series, and books
              ↓
      Your personal library
              ↓
    Choose a city or location
              ↓
 Stories with real places nearby
              ↓
   Explore scenes and locations
              ↓
 Build a walkable personal tour
```

## ❤️ Why it matters

Stories are emotional landmarks. They remind us of particular years, people, places, and versions of ourselves. Visiting a location from a beloved film, a long-running series, or a formative book is different from checking off another attraction—it feels like meeting something familiar in the real world.

GloryMap makes travel more personal by connecting three things that usually live apart:

- the stories that shaped us;
- the places where those stories live;
- and the time we have to explore them.

## 🔍 Built around trustworthy discovery

GloryMap combines public location knowledge, source-backed research, current place imagery, and walking directions. Each location explains its connection to the work and links back to supporting evidence whenever available.

Coverage is intentionally honest: a title appears only when GloryMap has a meaningful location for it in the selected area. The goal is not to fill the map with vague pins—it is to help every visible place earn its place in the journey.

## 🔐 Personal by design

Your collections shape the experience, but they remain yours. GloryMap keeps personal library information and saved places on the device, does not ask for streaming or reading passwords, and does not upload photos used to recreate a scene.

## 🎥 Try GloryMap

Open the demo, connect your story collection, choose a city, and see where your favorite worlds meet the real one.

### [🌍 Launch the live demo →](https://codex-hackathon-starter.vercel.app)

## ✅ What judges can test today

No account or credentials are required for the deployed application.

1. Open the [live demo](https://codex-hackathon-starter.vercel.app).
2. Search for a city, or keep London selected.
3. Explore the visible pins or search for a film, series, or book.
4. Open a location card to inspect its story context, source, and imagery.
5. Add at least three locations and select **Build route**.
6. Choose 30, 60, or 120 minutes and generate a nearby AI-guided tour.
7. Optionally import a Letterboxd ZIP or Letterboxd/IMDb CSV. The file is
   processed locally in the browser and is never uploaded.

No sample data is required: public story locations load automatically. Features
that use live external services may take several seconds.

## 🤖 How GPT-5.6 powers GloryMap

GPT-5.6 is part of the product workflow, not a decorative chat layer.

- **Grounded location discovery:** when Wikidata coverage is sparse,
  `app/api/locations/discover/route.js` uses GPT-5.6 with OpenAI web search.
  Every result must be supported by a consulted source, stay inside the selected
  city boundary, preserve an exact source URL, pass a Zod Structured Outputs
  schema, and survive application-level validation.
- **Validated tour generation:** `app/api/tour/route.js` sends only verified
  locations to GPT-5.6. The model writes short original guide narration through
  Structured Outputs. Server-side checks reject missing, duplicated, unknown, or
  reordered stops; timed tours preserve the route order already validated
  against real walking directions.
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

## 🛠️ Built with

Next.js 15, React 19, JavaScript, OpenAI Responses API, GPT-5.6, Structured
Outputs, OpenAI web search, OpenAI vision and text-to-speech, Leaflet, React
Leaflet, OpenStreetMap, Nominatim, Wikidata, Wikimedia Commons, TMDB, Zod, JSZip,
and Vercel.

## 🚀 Run locally

### Requirements

- Node.js 20+
- npm
- An OpenAI API key for AI discovery, guide, scene matching, and narration
- A TMDB API read access token for scene-image candidates

### Setup

```bash
git clone https://github.com/walklikeaman/codex-hackathon-starter.git
cd codex-hackathon-starter
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Replace placeholder values in
`.env.local`; never commit real credentials.

Important server-side variables are `OPENAI_API_KEY`,
`TMDB_API_READ_ACCESS_TOKEN`, and optional model overrides such as
`OPENAI_MODEL`, `OPENAI_SEARCH_MODEL`, `OPENAI_VISION_MODEL`, and
`OPENAI_TTS_MODEL`.

### Verify

```bash
npm test
npm run build
```

The current suite contains 89 tests covering imports, source validation,
location discovery, walking routes, tours, narration, and scene matching.

**GloryMap — visit the places that already feel like home.** 🍿📚🗺️
