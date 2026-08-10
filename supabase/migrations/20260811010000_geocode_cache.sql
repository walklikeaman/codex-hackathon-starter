-- Remember what the gazetteer said, including when it said nothing.
--
-- `cacheRow()` has been sitting in geocode-wikidata.mjs since the module was written, with
-- no table to write to and no caller — the shape was designed and never built. The queue
-- pass is what makes it necessary: 12,659 rows without a coordinate reduce to **10,579
-- distinct names**, which is ~1,320 WDQS queries and, at the module's own five-second
-- politeness gap, close to two hours before a single 429. A job that long will be
-- interrupted, and without a cache every restart asks the whole thing again.
--
-- **Refusals are cached too, and that is the point.** Measured on the first thousand rows,
-- 589 of 865 heads resolve to nothing at all — an ordinary house is not in Wikidata and
-- never will be. Caching only the hits would leave 68% of the corpus re-asked on every
-- run, which is both slow and rude to a free service.
--
-- `license` and `source` are mandatory from the first row, for the reason the original
-- comment gives: once CC0, CC BY and ODbL results are mixed in one table without them,
-- nobody can say what attribution the data owes.

create table if not exists geocode_cache (
  query_norm text primary key,
  -- NULL lat/lng is a real answer: "we asked, and there is nothing to find".
  lat double precision,
  lng double precision,
  source text not null,
  source_id text,
  license text,
  match_reason text not null,
  asked_at timestamptz not null default now(),
  constraint geocode_cache_coord_valid check (
    (lat is null and lng is null)
    or (lat between -90 and 90 and lng between -180 and 180)
  ),
  -- A hit must say where it came from and under what licence. A refusal owes neither,
  -- because there is nothing to attribute.
  constraint geocode_cache_hit_has_provenance check (
    lat is null or (source_id is not null and license is not null)
  )
);

comment on table geocode_cache is
  'One row per name ever asked of the gazetteer. A null coordinate means we asked and there was nothing to find — cached deliberately, because two thirds of this corpus resolves to nothing and re-asking is both slow and rude.';
comment on column geocode_cache.match_reason is
  'Why this answer was chosen, or why there was none: unique, exact_label, nearest_to_hint, dominant_population, same_place_multiple_records, no_candidate, ambiguous_homonyms.';

create index if not exists geocode_cache_hits_idx
  on geocode_cache (query_norm) where lat is not null;

alter table geocode_cache enable row level security;
drop policy if exists "geocode cache read" on geocode_cache;
create policy "geocode cache read" on geocode_cache for select using (true);
