-- content_graph — the canonical, globally-shared knowledge graph behind GloryMap.
-- See ARCHITECTURE.md: one places table (one row per real place) + work_place_links
-- (edges) + one place_evidence provenance ledger. map_points and per-work candidate
-- views are projections, never sources of truth.
--
-- NOTE: green-field. The repo previously had only user_media_libraries; the ad-hoc
-- locations/scenes tables were applied via MCP and are superseded by this schema.
-- Writes to graph tables are service_role only; per-user RLS lives on
-- user_library_items alone (foundational decision #4).
--
-- This migration is REVIEW-ONLY until the backend owner applies it
-- (supabase db push / MCP apply_migration) against the shared project.

create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- Consolidation: drop the superseded ad-hoc tables (empty, created out-of-band by
-- the earlier scenemap_initial_schema). The canonical graph below replaces them.
-- `scenes` in particular is recreated here with a different shape, so the old one
-- must go first (otherwise `create table if not exists` would keep the wrong schema
-- and the work_place_links.scene_id FK would fail on a type mismatch).
drop table if exists public.locations cascade;
drop table if exists public.scenes cascade;

-- One classification vocabulary (foundational decision #2). Detected by Wikidata
-- P31 BFS in the resolver, never by name. fictional/unknown may carry NULL coords.
do $$ begin
  create type place_class as enum (
    'real_exterior', 'real_interior', 'studio_interior',
    'fictional', 'narrative_real', 'unknown'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type relation_kind as enum (
    'filming_location', 'narrative_location',
    'author_place', 'artist_place', 'studio_of'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_method as enum (
    'wikidata_statement', 'wikidata_studio_entity', 'web_search_cited',
    'geoclip_infer', 'commons_geosearch', 'mapillary_match',
    'vision_verify', 'text_mention', 'manual_fix'
  );
exception when duplicate_object then null; end $$;

-- ---------- creators & works ----------
create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  wikidata_id text unique,
  name text not null,
  kind text not null check (kind in ('author', 'director', 'artist', 'band')),
  created_at timestamptz not null default now()
);

create table if not exists works (
  id uuid primary key default gen_random_uuid(),
  wikidata_id text unique,
  tmdb_id text,
  imdb_id text,
  isbn text,
  mbid text,                                   -- MusicBrainz id (music)
  kind text not null check (kind in ('film', 'series', 'book', 'track', 'album')),
  title text not null,
  title_norm text not null,                    -- NFKD a-z0-9, dedup key (pg_trgm)
  year integer,
  created_at timestamptz not null default now()
);
create index if not exists works_title_norm_trgm on works using gin (title_norm gin_trgm_ops);
create index if not exists works_tmdb_idx on works (tmdb_id);
create index if not exists works_imdb_idx on works (imdb_id);

create table if not exists work_creators (
  work_id uuid not null references works(id) on delete cascade,
  creator_id uuid not null references creators(id) on delete cascade,
  role text,
  primary key (work_id, creator_id, role)
);

-- ---------- places (canonical: one row per real place) ----------
create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  wikidata_id text unique,
  name text not null,
  city text,
  country text,
  lat double precision,                        -- NULL is legal (fictional / unresolved)
  lng double precision,
  place_class place_class not null default 'unknown',
  geocode_precision text not null default 'none'
    check (geocode_precision in ('country', 'city', 'street', 'building', 'point', 'none')),
  shot_on_set boolean not null default false,  -- studio/backlot depicts elsewhere
  confidence numeric(4, 3) not null default 0,
  confidence_band text not null default 'weak'
    check (confidence_band in ('verified', 'candidate', 'weak')),
  centroid geography(Point, 4326),             -- PostGIS, for bbox/KNN queries
  frame_embedding vector(512),                 -- pgvector, lazy-filled
  resolver_version text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  -- Coordinates must be valid when present (the never-invent invariant is also
  -- enforced in app/lib/grounding.mjs isPublishable()).
  constraint places_coord_valid check (
    (lat is null and lng is null) or
    (lat between -90 and 90 and lng between -180 and 180)
  )
);
create index if not exists places_centroid_gist on places using gist (centroid);
create index if not exists places_class_idx on places (place_class);

-- ---------- edges: a work's claim on a place ----------
create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  sequence_index integer,                      -- narrative order → Story Trails
  act_or_chapter text,
  plot_beat text,
  spoiler_tier smallint not null default 0,
  is_fictional_setting boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists scenes_work_idx on scenes (work_id);

create table if not exists work_place_links (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  scene_id uuid references scenes(id) on delete set null,
  relation_kind relation_kind not null,
  confidence numeric(4, 3) not null default 0,
  narrative_order integer,
  created_at timestamptz not null default now(),
  unique (work_id, place_id, relation_kind)
);
create index if not exists work_place_links_work_idx on work_place_links (work_id);
create index if not exists work_place_links_place_idx on work_place_links (place_id);

-- ---------- provenance ledger: 1 row = 1 signal (never invent) ----------
create table if not exists place_evidence (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('place', 'link', 'scene')),
  subject_id uuid not null,
  method evidence_method not null,
  source_url text,
  source_ref text,                             -- Q-id / statement-id / tmdb / image_id
  snippet text,
  cited_quote text,                            -- exact text for book text_mention
  agrees boolean,                              -- supports / contradicts / null = hypothesis
  weight numeric(4, 3),                        -- overrides the method prior when set
  model text,
  model_confidence text check (model_confidence in ('high', 'medium', 'low', 'none')),
  retrieved_at timestamptz not null default now()
);
create index if not exists place_evidence_subject_idx on place_evidence (subject_type, subject_id);

-- ---------- the ONLY per-user, RLS'd table ----------
create table if not exists user_library_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  source text not null check (source in
    ('letterboxd', 'imdb', 'trakt', 'kinopoisk', 'goodreads', 'openlibrary', 'lastfm', 'manual')),
  rating numeric,
  added_at timestamptz not null default now(),
  primary key (user_id, work_id, source)
);

-- ---------- RLS: graph is public-read/service-write; library is per-user ----------
alter table creators enable row level security;
alter table works enable row level security;
alter table work_creators enable row level security;
alter table places enable row level security;
alter table scenes enable row level security;
alter table work_place_links enable row level security;
alter table place_evidence enable row level security;
alter table user_library_items enable row level security;

-- Anyone may read the shared knowledge graph; only service_role writes it.
do $$
declare t text;
begin
  foreach t in array array['creators','works','work_creators','places','scenes','work_place_links','place_evidence']
  loop
    execute format('drop policy if exists "graph read" on %I', t);
    execute format('create policy "graph read" on %I for select using (true)', t);
  end loop;
end $$;

-- Per-user library: users see and manage only their own rows.
drop policy if exists "own library select" on user_library_items;
create policy "own library select" on user_library_items
  for select using (auth.uid() = user_id);
drop policy if exists "own library write" on user_library_items;
create policy "own library write" on user_library_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
