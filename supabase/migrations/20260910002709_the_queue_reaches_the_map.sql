-- The queue, on the browsable map.
--
-- Measured 10.09.2026 against production: `/api/map/points` over the whole Los Angeles
-- basin returns **one** feature — the city of Los Angeles itself, precision `city`. The
-- queue holds **5,266 located rows there across 1,642 works**. The map is the product's
-- main surface and it has been drawing 70 places worldwide while 32,148 located rows sat
-- one table away.
--
-- This is the same door `submission_places` opened for the work card in #158 and for the
-- per-film map path on 05.08, and it is the last surface without one. The rule does not
-- change: **a candidate is drawn as a candidate.** These rows do not enter `places`, do
-- not become facts, and carry their source and their review status so the interface
-- cannot render them like something we checked.
--
-- Shaped to mirror `map_points_in_view` / `map_clusters_in_view` deliberately — the same
-- viewport arithmetic, the same antimeridian case, the same zoom threshold, the same cap
-- — so the two layers cannot disagree about what "in view" means. A viewport that shows
-- a place and hides a candidate beside it would be a bug nobody could see.
--
-- **No `has_studio` here, unlike the places clusters.** Whether a point is inside a studio
-- lot is decided by the polygons in `app/lib/studio-lots.mjs`, and one definition of a
-- fence is the whole point of that file. Computing it a second time in SQL is how the map
-- and the card start disagreeing about Courthouse Square.

create index if not exists location_submissions_mappable_latlng_idx
  on location_submissions (lat, lng)
  where lat is not null and status <> 'rejected';

-- The work's year rides along so "my films only" can be decided in the BROWSER. The
-- owner's library lives in localStorage and never reaches this database ([[personal-library]]),
-- and `workIsInLibrary` matches on a normalised title and a year — without the year,
-- "Star Trek" is a film and a series and several of each.
drop function if exists map_candidate_points_in_view(
  double precision, double precision, double precision, double precision, integer, text[], integer, integer);

create function map_candidate_points_in_view(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_zoom integer default 12,
  p_kinds text[] default null,
  p_max_points integer default 2000,
  p_cluster_below_zoom integer default 12
)
returns table (
  submission_id uuid,
  work_id uuid,
  work_title text,
  work_kind text,
  name text,
  area_hint text,
  lat double precision,
  lng double precision,
  source_kind text,
  source_url text,
  status text
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    s.id, s.work_id, w.title, w.kind::text,
    s.place_name, s.area_hint, s.lat, s.lng,
    s.source_kind::text, s.source_url, s.status::text
  from location_submissions s
  join works w on w.id = s.work_id
  where s.lat is not null
    -- NOT REJECTED rather than pending: filtering on `pending` once meant believing a row
    -- a reviewer had already thrown out.
    and s.status <> 'rejected'
    -- (0, 0) is not a place. Four incidents in this project, all from `Number("")` being 0.
    and not (s.lat = 0 and s.lng = 0)
    and s.lat between least(p_south, p_north) and greatest(p_south, p_north)
    and (case when p_west <= p_east then s.lng between p_west and p_east
              else s.lng >= p_west or s.lng <= p_east end)
    and (p_kinds is null or w.kind = any(p_kinds))
    and p_zoom >= p_cluster_below_zoom
  -- A card that has been through the review leads, then a stable order. Without the id
  -- the rows at one address arrive in whatever order the scan produced, which is the tie
  -- that let the two ends of `place_facts` disagree in #129.
  order by (s.status = 'verified') desc, s.place_name, s.id
  limit case when p_zoom >= p_cluster_below_zoom then greatest(0, p_max_points) else 0 end
$$;

comment on function map_candidate_points_in_view is
  'Queue rows in a viewport, drawn as candidates. Mirrors map_points_in_view so the two layers agree about what is in view.';

create or replace function map_candidate_clusters_in_view(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_zoom integer default 6,
  p_kinds text[] default null,
  p_max_clusters integer default 2000
)
returns table (
  lat double precision,
  lng double precision,
  cluster_count integer,
  work_count integer,
  sample_name text
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  with visible as (
    select s.work_id, s.place_name, s.lat, s.lng
    from location_submissions s
    join works w on w.id = s.work_id
    where s.lat is not null
      and s.status <> 'rejected'
      and not (s.lat = 0 and s.lng = 0)
      and s.lat between least(p_south, p_north) and greatest(p_south, p_north)
      and (case when p_west <= p_east then s.lng between p_west and p_east
                else s.lng >= p_west or s.lng <= p_east end)
      and (p_kinds is null or w.kind = any(p_kinds))
  ),
  gridded as (
    select
      floor(lng / map_cluster_cell(p_zoom)) gx,
      floor(lat / map_cluster_cell(p_zoom)) gy,
      avg(lat) lat, avg(lng) lng,
      count(*)::int cluster_count,
      -- Places and the films behind them are two different numbers, and a cluster that
      -- states only the first cannot tell "one film with 87 pins" from "87 films".
      count(distinct work_id)::int work_count,
      (array_agg(place_name order by place_name))[1] sample_name
    from visible group by 1, 2
  )
  select lat, lng, cluster_count, work_count, sample_name
  from gridded order by cluster_count desc, lat, lng
  limit p_max_clusters
$$;

comment on function map_candidate_clusters_in_view is
  'The same queue rows, gridded for a zoomed-out viewport. Counts places AND the films behind them.';
