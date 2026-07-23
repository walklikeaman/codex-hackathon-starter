# ADR 0001 — Database & data foundation

**Status:** Accepted · **Date:** 2026-07-23 · Feeds [`ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Question

Is Supabase the right foundation for GloryMap? The project is small now and will
grow. Can we self-host it, should we replace it, and what is the correct *lower-level*
data architecture underneath the brand?

## Decision

**The fundamental substrate is Postgres — one relational database as the single
source of truth. Keep Supabase as the managed delivery layer over it.** "Supabase
or not" is a replaceable decision on top of a portable Postgres core.

## Why one Postgres is the right foundation (the low-level answer)

Our whole model is Postgres-shaped and fits in **one** instance:

- **The graph** (`works`/`places`/`work_place_links`/`scenes`/`place_evidence`)
  is 1–2 hop joins over an indexed edge table — **not** deep variable-length
  traversals. A `WITH RECURSIVE` over an indexed edges table handles tens of
  millions of edges sub-second. **Neo4j is not needed** (and would force a second
  system-of-record kept in sync — pure downside). Revisit only if a feature needs
  deep N-hop pathfinding/graph algorithms.
- **Geo** — PostGIS does bbox (`&&` + GiST), KNN (`<->`), clustering
  (`ST_ClusterDBSCAN`) and even vector map tiles in-DB (`ST_AsMVT`). No separate
  tile server needed now.
- **Vectors** — pgvector holds GeoCLIP 512-dim frame embeddings (HNSW, up to
  2000 dims) sub-ms at our scale, in the same row as the place. No separate
  vector store.

**Rule:** exactly one *system-of-record*. Satellite services are allowed for
**compute** (embeddings, tile cache), never as a second source of truth. Adding a
second database only when a documented limit is hit — not preemptively.

All three extensions (PostGIS, pgvector, pg_trgm) are the same Postgres container,
so graph ↔ geo ↔ vector join **without network hops or cross-service consistency
problems**.

## Why keep Supabase (for a small, growing project)

- **Extensions are free on every tier**, including Free — one `CREATE EXTENSION`.
  No pricing gate on PostGIS/pgvector/pg_trgm.
- **Batteries we already use**: Auth (Google/Facebook OAuth wired), Storage, RLS
  tooling, auto-API — at $0 with zero infra to run.
- **Free tier** (2026): 500 MB DB, 50k MAU, 1 GB Storage. **Pro is $25/mo/org**
  (removes the pause, adds 7-day backups, 8 GB→growing disk, 250 GB egress). Next
  tier is Team $599 — that's compliance (SOC2/SSO), not resources; irrelevant for
  a long time.

## Lock-in is LOW, and our design keeps it that way

- **100% portable**: the schema, PostGIS/pgvector/pg_trgm, and RLS are standard
  Postgres — they run unchanged on Neon / RDS / self-host.
- **Supabase-specific** (bounded, cheap to replace): `auth.uid()` in RLS
  (mechanical rewrite to `current_setting('app.user_id')`), the `auth.*` schema,
  PostgREST auto-API, the Storage API.
- **Our architecture minimizes it by design**: the graph is `anon`-readable with
  no auth dependency; `auth.uid()` appears **only** in `user_library_items`
  policies. Migrating off Supabase = a few hours for `pg_dump`/restore + a few
  days to move Auth — because the lock is concentrated in one small place.

## Guardrails (follow these to stay portable)

1. **Data access is server-side** — Next.js route handlers with a service-role
   key or direct `pg`. Do **not** build the main data layer on `supabase-js` /
   PostgREST on the client → the PostgREST/Realtime lock never accrues.
2. **Graph = `anon` read + `service_role` write**; `auth.uid()` only in the
   per-user library policies (already the case in the `content_graph` migration).
3. **Standard SQL + standard extensions only** in the schema (already done).
4. **Storage**: hotlink external images (Mapillary/TMDB/Commons) rather than
   copying them into Storage — also the free-tier egress guardrail. Use
   S3-compatible access for our own UGC.
5. **Own backups**: Free has none — schedule `pg_dump -Fc`.
6. **Fix the demo-killer**: Free **pauses after 7 days idle** (and releases the
   URL after 90 days paused). Keep a heartbeat, or go Pro ($25) before any demo.

## Exit option (proves there's no trap)

If we ever leave, **Neon** is the drop-in: real perpetual free tier, PostGIS
3.5/3.6 + pgvector 0.8 + pg_trgm, native RLS, Neon Auth (60k MAU free) + Data API,
and a documented Supabase→Neon import. Alternatives are worse fits: Fly Managed
Postgres ($38/mo, no free), Railway (no perpetual free), Render (free DB
self-destructs in 30 days). Non-Postgres (Turso/SQLite, PlanetScale/MySQL,
PocketBase) are **disqualified** — no PostGIS, no pgvector. We keep Neon in the
pocket; we do not act on it now.

## Growth path — scale without rewriting the core

The map is read-heavy; writes are rare (service-role graph imports), so a single
writer is fine. In order of cost/impact:

1. **Edge-cache** tiles/bbox responses on Vercel/CDN (huge win, cheap).
2. **Read replica** for map traffic (Neon replicas are cheap; managed = a second
   instance).
3. `vector` → **`halfvec`** (2 bytes/dim, half the RAM, ~same accuracy).
4. Only at 10M+ vectors with single-digit-ms SLA: consider a dedicated vector
   store — as a satellite, not the source of truth.

## GeoCLIP embeddings — a compute satellite, not a second DB

GeoCLIP (PyTorch/ViT-L/14) does not belong in a Vercel function. Run it as a
**scale-to-zero** service (Modal / HF Endpoints / Cloud Run) with a narrow
contract: *image → 512-vector*. The embedding is UPSERT'd back into pgvector with
a **model-version + dim tag** alongside it. The service never reads/writes the
graph or makes decisions — it only returns a vector. This does not violate "one
Postgres": it's compute, not a system-of-record.

## Consequences

- No change to the current stack; the `content_graph` migration already follows
  these guardrails.
- One follow-up: keep the client off `supabase-js` for the core data layer (route
  handlers instead) — cheap now, expensive to retrofit later.
