-- Corrections to the map read path, all found by adversarial review of the first cut.
--
-- 1. centroid was hand-written. The resolver's upsert only ever sets lat/lng, so any
--    place written after the initial seed had centroid NULL, and `NULL && box` is NULL,
--    not false — a fully evidenced, publishable point vanished from the map with a 200
--    and no warning. Making centroid GENERATED removes the whole drift class (it also
--    fixes a place whose lat/lng is later corrected keeping a stale centroid).
-- 2. The viewport is now filtered on lat/lng, which is what the pipeline actually fills,
--    and which can express an antimeridian-crossing window. centroid stays for future
--    KNN / radius work but is no longer load-bearing for the map.
-- 3. least/greatest on longitude turned a viewport crossing the antimeridian into its
--    own complement — the user panned past the date line and saw the whole rest of the
--    world instead of the strip in front of them.
-- 4. The publishability gate now includes evidence, matching grounding.isPublishable:
--    class + confidence alone could pin a place with an empty evidence ledger.

alter table places drop column if exists centroid;
alter table places add column centroid geography(Point, 4326)
  generated always as (
    case when lat is not null and lng is not null
         then st_setsrid(st_makepoint(lng, lat), 4326)::geography end
  ) stored;

drop index if exists places_centroid_geom_gix;   -- bbox no longer goes through PostGIS
create index if not exists places_centroid_gix on places using gist (centroid);
create index if not exists places_mappable_latlng_idx on places (lat, lng) where lat is not null;
create index if not exists place_evidence_subject_idx on place_evidence (subject_type, subject_id);

-- A place is shown only when it satisfies every arm of grounding.isPublishable:
-- a real coordinate, a geocoded class, enough confidence, and at least one piece of
-- evidence that does not contradict it (agrees null = hypothesis, still supporting).
create or replace function place_is_mappable(
  p_lat double precision, p_place_class place_class, p_confidence numeric, p_place_id uuid
)
returns boolean
language sql stable
as $$
  select p_lat is not null
     and p_place_class <> 'fictional'
     and p_confidence >= 0.4
     and exists (
       select 1 from place_evidence e
       where e.subject_type = 'place' and e.subject_id = p_place_id and e.agrees is not false
     );
$$;

create or replace function map_points_in_view(
  p_west double precision, p_south double precision, p_east double precision, p_north double precision,
  p_zoom int default 12, p_work_id uuid default null, p_kinds text[] default null,
  p_max_points int default 2000, p_cluster_below_zoom int default 12
)
returns table (
  point_kind text, place_id uuid, wikidata_id text, name text,
  lat double precision, lng double precision, place_class text, geocode_precision text,
  shot_on_set boolean, confidence numeric, confidence_band text,
  work_count integer, evidence_count integer, cluster_count integer
) language sql stable as $$
  with visible as (
    select p.* from places p
    where place_is_mappable(p.lat, p.place_class, p.confidence, p.id)
      and p.lat between least(p_south, p_north) and greatest(p_south, p_north)
      -- west > east means the viewport crosses the antimeridian: it is the union of
      -- [west, 180] and [-180, east], never the complement in between.
      and (case when p_west <= p_east then p.lng between p_west and p_east
                else p.lng >= p_west or p.lng <= p_east end)
      and (p_work_id is null or exists (
        select 1 from work_place_links l where l.place_id = p.id and l.work_id = p_work_id))
      and (p_kinds is null or exists (
        select 1 from work_place_links l join works w on w.id = l.work_id
        where l.place_id = p.id and w.kind = any(p_kinds)))
  )
  select 'place'::text, v.id, v.wikidata_id, v.name, v.lat, v.lng,
    v.place_class::text, v.geocode_precision, v.shot_on_set, v.confidence, v.confidence_band,
    (select count(*)::int from work_place_links l where l.place_id = v.id),
    (select count(*)::int from place_evidence e where e.subject_type = 'place' and e.subject_id = v.id),
    1
  from visible v
  where p_zoom >= p_cluster_below_zoom
  order by v.confidence desc, v.name
  limit case when p_zoom >= p_cluster_below_zoom then p_max_points else 0 end
$$;

create or replace function map_clusters_in_view(
  p_west double precision, p_south double precision, p_east double precision, p_north double precision,
  p_zoom int default 6, p_work_id uuid default null, p_kinds text[] default null,
  p_max_clusters int default 2000
)
returns table (lat double precision, lng double precision, cluster_count integer, sample_name text, has_studio boolean)
language sql stable as $$
  with visible as (
    select p.id, p.name, p.lat, p.lng, p.place_class, p.confidence from places p
    where place_is_mappable(p.lat, p.place_class, p.confidence, p.id)
      and p.lat between least(p_south, p_north) and greatest(p_south, p_north)
      and (case when p_west <= p_east then p.lng between p_west and p_east
                else p.lng >= p_west or p.lng <= p_east end)
      and (p_work_id is null or exists (
        select 1 from work_place_links l where l.place_id = p.id and l.work_id = p_work_id))
      and (p_kinds is null or exists (
        select 1 from work_place_links l join works w on w.id = l.work_id
        where l.place_id = p.id and w.kind = any(p_kinds)))
  ),
  gridded as (
    select floor(lng / map_cluster_cell(p_zoom)) gx, floor(lat / map_cluster_cell(p_zoom)) gy,
      avg(lat) lat, avg(lng) lng, count(*)::int cluster_count,
      (array_agg(name order by confidence desc, name))[1] sample_name,
      bool_or(place_class = 'studio_interior') has_studio
    from visible group by 1, 2
  )
  -- Capped like the point path. Biggest clusters win, so a truncated response still
  -- shows where the mass of the data is rather than an arbitrary corner of it.
  select lat, lng, cluster_count, sample_name, has_studio
  from gridded order by cluster_count desc, lat, lng
  limit p_max_clusters
$$;

-- Fiction is never pinned, but it is real content and must be listed. It honours the
-- same work/kind filters as the map, so the strip always describes the same query.
create or replace function fictional_places(
  p_work_id uuid default null, p_kinds text[] default null, p_limit int default 200
)
returns table (place_id uuid, wikidata_id text, name text, work_count integer)
language sql stable as $$
  select p.id, p.wikidata_id, p.name,
    (select count(*)::int from work_place_links l where l.place_id = p.id)
  from places p
  where p.place_class = 'fictional'
    and (p_work_id is null or exists (
      select 1 from work_place_links l where l.place_id = p.id and l.work_id = p_work_id))
    and (p_kinds is null or exists (
      select 1 from work_place_links l join works w on w.id = l.work_id
      where l.place_id = p.id and w.kind = any(p_kinds)))
  order by p.name
  limit p_limit
$$;
