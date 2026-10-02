-- The map carries the rating of whichever source the ranking is allowed to use (#224).
--
-- "Known for" ranks by RANKED_SOURCES (app/lib/notable-here.mjs): IMDb first, TMDB where
-- IMDb is silent, and the licence switch is taking "imdb" out of that list — IMDb's
-- dataset is non-commercial. But this function decided the same thing on its own, with
-- IMDb hard-coded first: TMDB rode only where IMDb was silent. Taking "imdb" out of the
-- client's list would have ranked nothing, because the map never sent a TMDB number for
-- a film IMDb rates — 0 of 89 films in a Soho viewport carried one.
--
-- So the list is now a parameter, and the API passes the same constant the client ranks
-- by. The default reproduces what was sent before exactly — same keys, same values, same
-- payload — and a list without "imdb" sends TMDB for every film TMDB rates and nothing
-- of IMDb's at all.
--
-- Carried from 20260921020000 unchanged: a promoted row (place_id set) is a checked
-- place now, and is not drawn again as a candidate.

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
  p_cluster_below_zoom integer default 12,
  p_rating_sources text[] default array['imdb', 'tmdb']
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
      -- Stored 0..100, stated 0..10, to one decimal. IMDb only if the ranking may use it.
      case when 'imdb' = any(p_rating_sources) then round(r.score / 10.0, 1) end as imdb_score,
      case when 'imdb' = any(p_rating_sources) then r.votes end as imdb_votes,
      -- TMDB where the ranking may use it and IMDb is not answering — either silent, or
      -- not allowed. One number per film, as before; never both to be averaged.
      case when 'tmdb' = any(p_rating_sources)
            and (r.score is null or not ('imdb' = any(p_rating_sources)))
           then round(t.score / 10.0, 1) end as tmdb_score,
      case when 'tmdb' = any(p_rating_sources)
            and (r.score is null or not ('imdb' = any(p_rating_sources)))
           then t.votes end as tmdb_votes
    from location_submissions s
    join works w on w.id = s.work_id
    left join work_ratings r on r.work_id = w.id and r.source = 'imdb'
    left join work_ratings t on t.work_id = w.id and t.source = 'tmdb'
    where s.lat is not null
      and s.status <> 'rejected'
      and s.place_id is null
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
        select distinct jsonb_strip_nulls(jsonb_build_object(
          'work_id', v2.work_id, 'title', v2.title, 'year', v2.year, 'kind', v2.kind,
          'place_name', v2.place_name, 'source_kind', v2.source_kind,
          'source_url', v2.source_url, 'status', v2.status,
          'imdb', v2.imdb_score, 'imdb_votes', v2.imdb_votes,
          'tmdb', v2.tmdb_score, 'tmdb_votes', v2.tmdb_votes,
          'note', left(v2.source_sentence, 400)
        )) as f
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
  'One row per distinct coordinate, carrying the films listed at it, one public rating per film from the first of p_rating_sources that has one (IMDb then TMDB by default; the API passes RANKED_SOURCES), on the 0..10 scale both state, and the sentence the place was found in. Nulls are stripped.';
