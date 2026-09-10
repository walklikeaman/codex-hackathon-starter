-- A pin is a PLACE, and a place can be in ninety-six films.
--
-- Measured 11.09.2026 over the Los Angeles basin: **5,266 queue rows sit on 2,024 distinct
-- coordinates.** 566 of those points carry more than one film, and **3,750 rows — 71% of
-- everything we hold there — were drawn on top of each other**, invisible. The busiest
-- single coordinate is the Millennium Biltmore Hotel with **96 films** stacked on it;
-- the RMS Queen Mary has 88, the former Ambassador Hotel 60, Griffith Observatory 40.
--
-- One row per row was the wrong shape twice over. It hides most of the data behind the
-- topmost pin, and it wastes the response cap: 5,266 rows against a 1,000-row ceiling
-- truncates two thirds of the city, while 2,024 points is a different question entirely.
-- Grouping BEFORE the limit is the same lesson as `MAX_ROWS_PER_RESPONSE` — a cap applied
-- to the wrong unit throws away what it should never have counted.
--
-- **Grouped on the exact coordinate, to five decimals (~1.1 m), and no closer.** Two
-- entrances of one studio fifty metres apart stay two pins: merging them would invent a
-- claim that the sources agreed on one point when they did not. This groups only rows that
-- already carry the identical coordinate, which is what "the same place, listed by several
-- films" actually looks like in this data.
--
-- `films` carries the work rows for the popup and the panel to list. Capped at 40 inside
-- the array with `work_count` stating the true total beside it — a card that prints its own
-- display cap as the number we hold is the silent truncation this project shipped once
-- already.

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
      w.title, w.year, w.kind::text as kind
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
  )
  select
    v.glat,
    v.glng,
    -- The sources rarely spell one address the same way twice. The shortest name is the
    -- least likely to be a sentence about the scene, which is what the long ones are.
    (array_agg(v.place_name order by length(v.place_name), v.place_name))[1],
    (array_agg(v.area_hint order by length(coalesce(v.area_hint, '')) desc))[1],
    count(*)::int,
    count(distinct v.work_id)::int,
    -- A point where anything has been reviewed leads; the panel says which.
    (case when bool_or(v.status = 'verified') then 'verified' else 'pending' end),
    (
      select jsonb_agg(f order by f->>'title')
      from (
        select distinct jsonb_build_object(
          'work_id', v2.work_id, 'title', v2.title, 'year', v2.year, 'kind', v2.kind,
          'place_name', v2.place_name, 'source_kind', v2.source_kind,
          'source_url', v2.source_url, 'status', v2.status
        ) as f
        from visible v2
        where v2.glat = v.glat and v2.glng = v.glng
        limit 40
      ) capped
    )
  from visible v
  group by v.glat, v.glng
  -- The busiest points first, so a truncated response keeps the ones worth seeing.
  order by count(distinct v.work_id) desc, v.glat, v.glng
  limit case when p_zoom >= p_cluster_below_zoom then greatest(0, p_max_points) else 0 end
$$;

comment on function map_candidate_points_in_view is
  'One row per distinct coordinate, carrying the films listed at it. 5,266 Los Angeles rows collapse to 2,024 points; 71% of them were drawn on top of each other before this.';
