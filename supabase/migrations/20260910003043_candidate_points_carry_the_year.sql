-- The year, so the client can tell two films apart without asking the server who I am.
--
-- The owner's library lives in localStorage and never reaches this database — that is the
-- rule [[personal-library]] states, and the reason "my films only" has to be decided in the
-- browser. `workIsInLibrary` matches on a normalised title AND a year, so a candidate that
-- arrives without one can only be matched by title, and "Star Trek" is a film and a series
-- and several of each.
--
-- Cheap: `works.year` is already on the row this function joins.
--
-- Dropped and recreated rather than replaced: adding an OUT column changes the row type,
-- and `create or replace` refuses. Nothing depended on it — it shipped the same morning.

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
  work_year integer,
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
    s.id, s.work_id, w.title, w.year, w.kind::text,
    s.place_name, s.area_hint, s.lat, s.lng,
    s.source_kind::text, s.source_url, s.status::text
  from location_submissions s
  join works w on w.id = s.work_id
  where s.lat is not null
    and s.status <> 'rejected'
    and not (s.lat = 0 and s.lng = 0)
    and s.lat between least(p_south, p_north) and greatest(p_south, p_north)
    and (case when p_west <= p_east then s.lng between p_west and p_east
              else s.lng >= p_west or s.lng <= p_east end)
    and (p_kinds is null or w.kind = any(p_kinds))
    and p_zoom >= p_cluster_below_zoom
  order by (s.status = 'verified') desc, s.place_name, s.id
  limit case when p_zoom >= p_cluster_below_zoom then greatest(0, p_max_points) else 0 end
$$;

comment on function map_candidate_points_in_view is
  'Queue rows in a viewport, drawn as candidates. Mirrors map_points_in_view so the two layers agree about what is in view. Carries the work year so a browser-side library filter can match without the library ever leaving the browser.';
