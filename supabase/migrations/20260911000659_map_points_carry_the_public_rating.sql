-- The public score, on the pin's film list, so the map can be filtered by it.
--
-- `work_ratings` held **32 rows across 12 works** out of 7,063 until 11.09; of the 1,642
-- works with a Los Angeles row, exactly one carried a rating. A filter on a public score
-- would have sorted 1,641 films by null, which is why the first rating filter could only
-- ever be the reader's own.
--
-- It now holds **5,495 IMDb ratings**, from IMDb's own published dataset — the route
-- [[source-evaluation]] explicitly allowed while refusing the site itself. **1,519 of the
-- 1,642 Los Angeles works carry one** (92.5%), and 355 of those are 7.5 or better.
--
-- Carried on each film in the point's list rather than fetched separately, because the
-- filter runs in the browser beside the reader's own ratings ([[personal-library]] — the
-- library never reaches the server) and both have to be answerable from the same row.
-- `votes` rides along because a 9.1 from 120 people is not a 9.1 from 900,000.

drop function if exists map_candidate_points_in_view(
  double precision, double precision, double precision, double precision, integer, text[], integer, integer);

create function map_candidate_points_in_view(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_zoom integer default 12,
  p_kinds text[] default null,
  p_max_points integer default 1000,
  p_cluster_below_zoom integer default 12
)
returns table (
  lat double precision,
  lng double precision,
  place_name text,
  area_hint text,
  row_count integer,
  work_count integer,
  status text,
  films jsonb
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  with visible as (
    select
      round(s.lat::numeric, 5)::double precision as glat,
      round(s.lng::numeric, 5)::double precision as glng,
      s.id, s.work_id, s.place_name, s.area_hint, s.source_kind, s.source_url, s.status,
      w.title, w.year, w.kind::text as kind,
      r.score as imdb_score, r.votes as imdb_votes
    from location_submissions s
    join works w on w.id = s.work_id
    left join work_ratings r on r.work_id = w.id and r.source = 'imdb'
    where s.lat is not null
      and s.status <> 'rejected'
      and not (s.lat = 0 and s.lng = 0)
      and s.lat between least(p_south, p_north) and greatest(p_south, p_north)
      and (case when p_west <= p_east then s.lng between p_west and p_east
                else s.lng >= p_west or s.lng <= p_east end)
      and (p_kinds is null or w.kind = any(p_kinds))
      and p_zoom >= p_cluster_below_zoom
  )
  select
    v.glat,
    v.glng,
    (array_agg(v.place_name order by length(v.place_name), v.place_name))[1],
    (array_agg(v.area_hint order by length(coalesce(v.area_hint, '')) desc))[1],
    count(*)::int,
    count(distinct v.work_id)::int,
    (case when bool_or(v.status = 'verified') then 'verified' else 'pending' end),
    (
      select jsonb_agg(f order by f->>'title')
      from (
        select distinct jsonb_build_object(
          'work_id', v2.work_id, 'title', v2.title, 'year', v2.year, 'kind', v2.kind,
          'place_name', v2.place_name, 'source_kind', v2.source_kind,
          'source_url', v2.source_url, 'status', v2.status,
          -- Null where nobody has rated it, never 0: unrated and terrible are different
          -- answers, and a filter has to be able to tell them apart.
          'imdb', v2.imdb_score, 'imdb_votes', v2.imdb_votes
        ) as f
        from visible v2
        where v2.glat = v.glat and v2.glng = v.glng
        limit 40
      ) capped
    )
  from visible v
  group by v.glat, v.glng
  order by count(distinct v.work_id) desc, v.glat, v.glng
  limit case when p_zoom >= p_cluster_below_zoom then greatest(0, p_max_points) else 0 end
$$;

comment on function map_candidate_points_in_view is
  'One row per distinct coordinate, carrying the films listed at it and each film''s IMDb score, so the map can be filtered by rating in the browser beside the reader''s own.';
