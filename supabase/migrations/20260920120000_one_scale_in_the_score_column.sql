-- Two scales lived in one column, and the column's own comment named only one (#224).
--
-- `work_ratings.score` is documented as "Normalised 0..100 so different scales can be
-- compared and sorted". Measured 20.09.2026:
--
--   imdb              5,495 rows   1.70 – 9.50     ← the source's own scale, written straight through
--   rotten_tomatoes      10 rows  65.00 – 99.00
--   metacritic           10 rows  55.00 – 97.00
--
-- So every IMDb row sorted below every Rotten Tomatoes row, and nothing said so. The one
-- thing the column exists for — comparing sources — was the one thing it could not do.
-- Nobody had noticed because the only numeric reader is the map, and the map reads IMDb
-- alone: the work page renders `display`, which was always right.
--
-- The IMDb rows move to the documented scale. `display` is untouched — it is the source's
-- own wording ("8.8/10") and always was.
--
-- **Guarded, so a second run is a no-op.** `score <= 10` is true of exactly the rows still
-- in the old scale: a real 0..100 IMDb rating of 10 or less would be a film rated 1.0/10 or
-- worse, and there is none — the minimum in the table is 1.70, which becomes 17.
update work_ratings
   set score = score * 10
 where source in ('imdb', 'tmdb')
   and score <= 10;

comment on column work_ratings.score is
  'Normalised 0..100 for cross-source comparison. IMDb and TMDB state 0..10, Rotten Tomatoes and Metacritic 0..100; `display` keeps the source''s own wording. See app/lib/work-ratings.mjs scoreInSourceScale.';

-- And the map hands the client the scale it has always been given.
--
-- `imdb` in the point payload feeds the rating slider, the "Known for" ranking and the
-- number printed on a row — all of them 0..10. Rescaling the column without this would have
-- put "88" where "8.8" belongs and made a filter set to 8 keep everything.
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
      s.source_sentence,
      w.title, w.year, w.kind::text as kind,
      -- Stored 0..100, stated 0..10. The division is the whole reason this function is
      -- rewritten here rather than in a later migration.
      (r.score / 10.0) as imdb_score, r.votes as imdb_votes
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
          'imdb', v2.imdb_score, 'imdb_votes', v2.imdb_votes,
          -- The prose, as the source wrote it. Cleaned in the browser rather than here.
          'note', left(v2.source_sentence, 400)
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
  'One row per distinct coordinate, carrying the films listed at it, each film''s IMDb score on the 0..10 scale IMDb states, and the sentence the place was found in.';
