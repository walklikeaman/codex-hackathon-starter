-- Two additions the map layer needs to become navigable rather than just visible.
--
-- 1. remote_points — KNN. Zoom into a city we have nothing for and the honest answer
--    is not an empty map but "nothing here; the nearest grounded place is X, 40 km
--    away". Ordered by the geography <-> operator so the GiST index on centroid does
--    the work; this is the first thing that actually uses that index (the viewport
--    filter deliberately went to lat/lng).
-- 2. map_works — the works that actually have mappable places, so the "this work"
--    filter can offer real options instead of a list of dead ends.
--
-- Both reuse place_is_mappable(), so what counts as shown is defined once.

create or replace function remote_points(
  p_lat double precision,
  p_lng double precision,
  p_limit int default 3,
  p_work_id uuid default null,
  p_kinds text[] default null
)
returns table (
  place_id uuid, wikidata_id text, name text,
  lat double precision, lng double precision,
  place_class text, geocode_precision text, shot_on_set boolean,
  confidence numeric, confidence_band text,
  work_count integer, evidence_count integer,
  distance_m double precision
)
language sql stable
as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select p.id, p.wikidata_id, p.name, p.lat, p.lng,
    p.place_class::text, p.geocode_precision, p.shot_on_set,
    p.confidence, p.confidence_band,
    (select count(*)::int from work_place_links l where l.place_id = p.id),
    (select count(*)::int from place_evidence e
      where e.subject_type = 'place' and e.subject_id = p.id),
    st_distance(p.centroid, o.g)
  from places p, origin o
  where place_is_mappable(p.lat, p.place_class, p.confidence, p.id)
    and (p_work_id is null or exists (
      select 1 from work_place_links l where l.place_id = p.id and l.work_id = p_work_id))
    and (p_kinds is null or exists (
      select 1 from work_place_links l join works w on w.id = l.work_id
      where l.place_id = p.id and w.kind = any(p_kinds)))
  order by p.centroid <-> o.g
  limit greatest(1, least(p_limit, 20))
$$;

create or replace function map_works(p_kinds text[] default null, p_limit int default 200)
returns table (work_id uuid, title text, kind text, place_count integer)
language sql stable
as $$
  select w.id, w.title, w.kind, count(distinct l.place_id)::int as place_count
  from works w
  join work_place_links l on l.work_id = w.id
  join places p on p.id = l.place_id
  where place_is_mappable(p.lat, p.place_class, p.confidence, p.id)
    and (p_kinds is null or w.kind = any(p_kinds))
  group by w.id, w.title, w.kind
  order by count(distinct l.place_id) desc, w.title
  limit p_limit
$$;
