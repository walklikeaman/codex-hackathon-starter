-- The directory (#158): 6,392 works and 32,148 located rows, none of which had a URL.
--
-- Two questions need answering cheaply and neither could be asked before this file:
--
--   1. "what films do you hold near here?"  — the city page
--   2. "what do you hold at all?"           — the A–Z index of works
--
-- The second is a view away. The first is the interesting one, and the shape of it is
-- decided by a measurement rather than by taste: a city here is **a coordinate and a
-- radius, never a string**. Measured on 18.08 against this database, grouping the
-- located rows by the city written in their address gives "London" a spread of 10,959 km
-- (London, Ontario), "Richmond" 8,097 km (British Columbia, Virginia and upon Thames)
-- and 80 works under "Unnamed Road". The name in an address is a label; only the point
-- is an identity. So membership is spatial and the name lives in the client's gazetteer
-- (app/lib/city-gazetteer.mjs), which is why these functions take a lat/lng and not a
-- city id — nothing about the set of cities belongs in the database.

-- ---------- the A–Z index needs a title, and the view only exposed title_norm ----------
--
-- Added at the END of the column list on purpose: `create or replace view` may append
-- columns but may not reorder them, and /api/catalogue selects by name, so this cannot
-- break the personal-library download that already reads this view.
create or replace view catalogue_index as
  select
    w.id,
    w.title_norm,
    w.year,
    w.kind,
    w.imdb_id,
    w.tmdb_id,
    count(*) filter (where s.lat is not null)::int as place_count,
    w.title
  from works w
  join location_submissions s
    on s.work_id = w.id
   and s.status <> 'rejected'
  group by w.id, w.title_norm, w.year, w.kind, w.imdb_id, w.tmdb_id, w.title
  having count(*) filter (where s.lat is not null) > 0;

alter view catalogue_index set (security_invoker = true);

comment on view catalogue_index is
  'Works with at least one located, unrejected submission. Downloaded whole so a personal library can be matched in the browser without ever being uploaded; also the source of the A-Z directory, which needs the display title as well as the dedup key.';

-- ---------- a spatial index for the radius queries ----------
--
-- 32,148 located rows is small enough that a sequential scan answers in milliseconds, so
-- this is not what makes the city page work — it is what keeps it working when the queue
-- grows. Partial, because a row without coordinates can never be inside any radius.
create index if not exists location_submissions_geog_idx
  on location_submissions
  using gist ((st_setsrid(st_makepoint(lng, lat), 4326)::geography))
  where lat is not null;

-- ---------- one city page ----------
--
-- Ordered by how many places we hold, then by title. That order is the honest one for a
-- directory whose coverage is thin by nature: 41.7% of the works here have exactly one
-- place, and a reader scanning a city should meet the ones we can actually walk first.
--
-- `total_works` and `total_points` ride on every row rather than costing a second query.
-- A window function is evaluated before LIMIT, so both are counts over the whole city and
-- not over the page — which is what lets the page say "48 of 656" without asking twice.
create or replace function city_catalogue(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 20,
  p_limit integer default 60,
  p_offset integer default 0
)
returns table (
  work_id uuid,
  title text,
  year integer,
  kind text,
  place_count integer,
  places text[],
  total_works integer,
  total_points integer
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  with near as (
    select s.work_id, s.place_name
    from location_submissions s
    where s.lat is not null
      and s.status <> 'rejected'
      -- Null Island is not a place. `Number("")` is 0 and 0 is finite, which has put a
      -- pin off the coast of Ghana four times in this project; a city 20 km from (0,0)
      -- would inherit every one of them.
      and not (s.lat = 0 and s.lng = 0)
      and st_dwithin(
            st_setsrid(st_makepoint(s.lng, s.lat), 4326)::geography,
            st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
            greatest(1, least(p_radius_km, 200)) * 1000)
  ), grouped as (
    select
      n.work_id,
      count(*)::int as place_count,
      -- Six names is what a row can show without becoming a list of its own. Distinct,
      -- because the same venue arrives from several sources and a card that says
      -- "Grand Central Terminal" three times reads as a bug.
      (array_agg(distinct n.place_name order by n.place_name))[1:6] as places
    from near n
    group by n.work_id
  )
  select
    g.work_id,
    w.title,
    w.year,
    w.kind::text,
    g.place_count,
    g.places,
    count(*) over ()::int,
    sum(g.place_count) over ()::int
  from grouped g
  join works w on w.id = g.work_id
  order by g.place_count desc, w.title asc
  limit greatest(1, least(p_limit, 200))
  offset greatest(0, p_offset)
$$;

comment on function city_catalogue(double precision, double precision, double precision, integer, integer) is
  'The films we hold places for within a radius of a point, most-covered first. A city is a coordinate and a radius here, never a name: grouping by the city written in an address puts London, Ontario inside London.';

-- ---------- every city at once, for the index ----------
--
-- The index page needs one number per city and there are dozens of them, so it asks once
-- with the whole gazetteer rather than once per city. The anchors travel from the client
-- because the client owns them: adding a city must not need a migration.
create or replace function city_catalogue_totals(p_anchors jsonb)
returns table (slug text, works integer, points integer)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    a.slug,
    count(distinct s.work_id)::int,
    count(s.*)::int
  from jsonb_to_recordset(coalesce(p_anchors, '[]'::jsonb))
    as a(slug text, lat double precision, lng double precision, radius_km double precision)
  -- LEFT, so a city we hold nothing for answers zero instead of vanishing from the index.
  -- A directory that silently drops its empty entries is the padded kind this one is not.
  left join location_submissions s
    on s.lat is not null
   and s.status <> 'rejected'
   and not (s.lat = 0 and s.lng = 0)
   and st_dwithin(
         st_setsrid(st_makepoint(s.lng, s.lat), 4326)::geography,
         st_setsrid(st_makepoint(a.lng, a.lat), 4326)::geography,
         greatest(1, least(coalesce(a.radius_km, 20), 200)) * 1000)
  where a.slug is not null and a.lat is not null and a.lng is not null
  group by a.slug
$$;

comment on function city_catalogue_totals(jsonb) is
  'Works and points held within each supplied anchor. One query for the whole directory index; the anchors come from the client because the set of cities is not the database''s business.';
