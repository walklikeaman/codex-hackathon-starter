-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

create index if not exists places_centroid_geom_gix on places using gist ((centroid::geometry));

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
  with viewport as (
    select st_makeenvelope(least(p_west,p_east), least(p_south,p_north),
                           greatest(p_west,p_east), greatest(p_south,p_north), 4326) as box
  ),
  visible as (
    select p.* from places p, viewport v
    where p.lat is not null and p.place_class <> 'fictional' and p.confidence >= 0.4
      and p.centroid::geometry && v.box
      and (p_work_id is null or exists (select 1 from work_place_links l where l.place_id = p.id and l.work_id = p_work_id))
      and (p_kinds is null or exists (select 1 from work_place_links l join works w on w.id = l.work_id where l.place_id = p.id and w.kind = any(p_kinds)))
  )
  select 'place'::text, v.id, v.wikidata_id, v.name, v.lat, v.lng,
    v.place_class::text, v.geocode_precision, v.shot_on_set, v.confidence, v.confidence_band,
    (select count(*)::int from work_place_links l where l.place_id = v.id),
    (select count(*)::int from place_evidence e where e.subject_type='place' and e.subject_id = v.id),
    1
  from visible v
  where p_zoom >= p_cluster_below_zoom
  order by v.confidence desc, v.name
  limit case when p_zoom >= p_cluster_below_zoom then p_max_points else 0 end
$$;

create or replace function map_clusters_in_view(
  p_west double precision, p_south double precision, p_east double precision, p_north double precision,
  p_zoom int default 6, p_work_id uuid default null, p_kinds text[] default null
)
returns table (lat double precision, lng double precision, cluster_count integer, sample_name text, has_studio boolean)
language sql stable as $$
  with viewport as (
    select st_makeenvelope(least(p_west,p_east), least(p_south,p_north),
                           greatest(p_west,p_east), greatest(p_south,p_north), 4326) as box
  ),
  visible as (
    select p.id, p.name, p.lat, p.lng, p.place_class, p.confidence from places p, viewport v
    where p.lat is not null and p.place_class <> 'fictional' and p.confidence >= 0.4
      and p.centroid::geometry && v.box
      and (p_work_id is null or exists (select 1 from work_place_links l where l.place_id = p.id and l.work_id = p_work_id))
      and (p_kinds is null or exists (select 1 from work_place_links l join works w on w.id = l.work_id where l.place_id = p.id and w.kind = any(p_kinds)))
  ),
  gridded as (
    select floor(lng / map_cluster_cell(p_zoom)) gx, floor(lat / map_cluster_cell(p_zoom)) gy,
      avg(lat) lat, avg(lng) lng, count(*)::int cluster_count,
      (array_agg(name order by confidence desc, name))[1] sample_name,
      bool_or(place_class = 'studio_interior') has_studio
    from visible group by 1,2
  )
  select lat, lng, cluster_count, sample_name, has_studio from gridded
$$;
