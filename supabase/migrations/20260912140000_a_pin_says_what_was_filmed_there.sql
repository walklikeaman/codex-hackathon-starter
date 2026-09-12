-- The sentence the place was found in, on the pin (#244).
--
-- A pin said "Forrest Gump" and the card under it said "Filming location". Both true,
-- neither an answer to what a person clicking a pin is asking: *what happens here*. We
-- were holding the answer the whole time — every queue row carries `source_sentence`, the
-- line of prose the place was discovered in — and the map never carried it out.
--
-- Measured over the 32,368 located rows, 12.09.2026, after the attribution tail is
-- removed in the browser (see [[place-note]]):
--
--   moviemaps       30,122 rows   77% say what the place plays
--   movielocations   1,501 rows  100%
--   reelstreets        412 rows  100%
--   wikipedia          270 rows  100%
--   open_plaques        53 rows  100%
--   permit_record       10 rows    0%  — a permit is a date and an address, never a scene
--
-- A random 300-row sample run through the cleaner returns a note for **78%** of them:
-- "‘Gotham City's link to ‘The Narrows'", "Appears as \"Luke's Bar\". Jessica heads to
-- Luke's bar to watch him from afar", "Deckard drives down a shiny tunnel on his way home".
--
-- **Capped at 400 characters in SQL, and trimmed again to 160 for display.** The median
-- sentence is 71 characters and the 90th percentile is 218, so the cap costs almost
-- nothing and bounds what a thousand points times forty films could otherwise become:
-- the longest row in the table is 1,069 characters, and forty of those on a thousand pins
-- is a 40 MB response. A cap on the payload belongs where the payload is built.
--
-- Nothing else changes: same signature, same grouping, same ordering.

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
          'imdb', v2.imdb_score, 'imdb_votes', v2.imdb_votes,
          -- The prose, as the source wrote it. Cleaned in the browser rather than here,
          -- because the rules that strip "Source: IMDb" and the repeated address are
          -- rules about what a READER should see, and they are tested there against real
          -- rows — a sentence mangled in SQL is mangled for every consumer for ever.
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
  'One row per distinct coordinate, carrying the films listed at it, each film''s IMDb score, and the sentence the place was found in — so a pin can say what was filmed there instead of only which film.';
