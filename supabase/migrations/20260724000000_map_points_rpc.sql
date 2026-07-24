-- Map read path: the map reads the persistent graph instead of live SPARQL.
-- One RPC answers a viewport: individual places when zoomed in, grid clusters when
-- zoomed out, so thousands of points cost one indexed query instead of N markers.
--
-- Publishability mirrors app/lib/grounding.mjs isPublishable(): a point needs a valid
-- coordinate, a geocoded class (fictional is deliberately never pinned) and at least
-- MAP_THRESHOLD confidence. Keep the 0.4 here in step with CONFIDENCE_BANDS.candidate.

create index if not exists places_centroid_gix on places using gist (centroid);
-- Bbox filtering happens in GEOMETRY space, not geography: a world-spanning envelope
-- cast to geography is degenerate (st_area = 0) and matches nothing, so a zoomed-out
-- map would silently show zero points. This expression index backs the && operator.
create index if not exists places_centroid_geom_gix on places using gist ((centroid::geometry));
create index if not exists places_mappable_idx on places (place_class, confidence)
  where lat is not null;

-- Grid cell size in degrees for a given zoom. Roughly one cell per ~60 screen px, so
-- clusters stay visually separated as the user zooms.
create or replace function map_cluster_cell(zoom int)
returns double precision
language sql immutable
as $$
  select greatest(0.0005, 360.0 / power(2, greatest(zoom, 0) + 5));
$$;

-- Points (or clusters) inside a viewport.
--   zoom >= cluster_below_zoom → individual places, capped at max_points
--   zoom <  cluster_below_zoom → one row per grid cell with a count
-- p_work_id restricts to a single work ("this film" layer); p_kinds restricts by
-- work kind (film/series/book/...). Both null = the whole graph.
create or replace function map_points_in_view(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_zoom int default 12,
  p_work_id uuid default null,
  p_kinds text[] default null,
  p_max_points int default 2000,
  p_cluster_below_zoom int default 12
)
returns table (
  point_kind text,
  place_id uuid,
  wikidata_id text,
  name text,
  lat double precision,
  lng double precision,
  place_class text,
  geocode_precision text,
  shot_on_set boolean,
  confidence numeric,
  confidence_band text,
  work_count integer,
  evidence_count integer,
  cluster_count integer
)
language sql
stable
as $$
  with viewport as (
    select st_makeenvelope(
      least(p_west, p_east), least(p_south, p_north),
      greatest(p_west, p_east), greatest(p_south, p_north), 4326
    ) as box
  ),
  visible as (
    select p.*
    from places p, viewport v
    where p.lat is not null
      and p.place_class <> 'fictional'          -- never pinned; surfaced separately
      and p.confidence >= 0.4                   -- grounding MAP_THRESHOLD
      and p.centroid::geometry && v.box
      and (
        p_work_id is null or exists (
          select 1 from work_place_links l
          where l.place_id = p.id and l.work_id = p_work_id
        )
      )
      and (
        p_kinds is null or exists (
          select 1 from work_place_links l join works w on w.id = l.work_id
          where l.place_id = p.id and w.kind = any(p_kinds)
        )
      )
  )
  select
    'place'::text,
    v.id,
    v.wikidata_id,
    v.name,
    v.lat,
    v.lng,
    v.place_class::text,
    v.geocode_precision,
    v.shot_on_set,
    v.confidence,
    v.confidence_band,
    (select count(*)::int from work_place_links l where l.place_id = v.id),
    (select count(*)::int from place_evidence e where e.subject_type = 'place' and e.subject_id = v.id),
    1
  from visible v
  where p_zoom >= p_cluster_below_zoom
  order by v.confidence desc, v.name
  limit case when p_zoom >= p_cluster_below_zoom then p_max_points else 0 end
$$;

-- Clusters are a separate function rather than a branch inside the one above so each
-- keeps a single, statically-typed result shape and a simple query plan.
create or replace function map_clusters_in_view(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_zoom int default 6,
  p_work_id uuid default null,
  p_kinds text[] default null
)
returns table (
  lat double precision,
  lng double precision,
  cluster_count integer,
  sample_name text,
  has_studio boolean
)
language sql
stable
as $$
  with viewport as (
    select st_makeenvelope(
      least(p_west, p_east), least(p_south, p_north),
      greatest(p_west, p_east), greatest(p_south, p_north), 4326
    ) as box
  ),
  visible as (
    select p.id, p.name, p.lat, p.lng, p.place_class, p.confidence
    from places p, viewport v
    where p.lat is not null
      and p.place_class <> 'fictional'
      and p.confidence >= 0.4
      and p.centroid::geometry && v.box
      and (
        p_work_id is null or exists (
          select 1 from work_place_links l
          where l.place_id = p.id and l.work_id = p_work_id
        )
      )
      and (
        p_kinds is null or exists (
          select 1 from work_place_links l join works w on w.id = l.work_id
          where l.place_id = p.id and w.kind = any(p_kinds)
        )
      )
  ),
  gridded as (
    select
      floor(lng / map_cluster_cell(p_zoom)) as gx,
      floor(lat / map_cluster_cell(p_zoom)) as gy,
      avg(lat) as lat,
      avg(lng) as lng,
      count(*)::int as cluster_count,
      (array_agg(name order by confidence desc, name))[1] as sample_name,
      bool_or(place_class = 'studio_interior') as has_studio
    from visible
    group by 1, 2
  )
  select lat, lng, cluster_count, sample_name, has_studio from gridded
$$;

-- Fictional places can't be pinned, but they are real content and must be shown as a
-- strip ("this work is set in Mordor"), never silently dropped.
create or replace function fictional_places(p_work_id uuid default null)
returns table (
  place_id uuid,
  wikidata_id text,
  name text,
  work_count integer
)
language sql
stable
as $$
  select p.id, p.wikidata_id, p.name,
         (select count(*)::int from work_place_links l where l.place_id = p.id)
  from places p
  where p.place_class = 'fictional'
    and (
      p_work_id is null or exists (
        select 1 from work_place_links l where l.place_id = p.id and l.work_id = p_work_id
      )
    )
  order by p.name
$$;
