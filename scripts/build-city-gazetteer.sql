-- Rebuilds the candidate list behind app/lib/city-gazetteer.mjs (#158).
--
-- Run it against production when the queue has grown enough to be worth re-deriving, read
-- the output, and paste the rows into the gazetteer. It is deliberately NOT wired into the
-- app: a city appearing or disappearing between two page loads because an ingest ran is
-- worse than a list that is a commit somebody looked at.
--
--   psql "$DATABASE_URL" -f scripts/build-city-gazetteer.sql
--
-- Each rule below exists because the version without it was wrong in a way that looked
-- right. Measured 18.08.2026 against 32,148 located rows:
--
--   no rule at all      "London" spans 10,959 km, "Richmond" 8,097 km, "Unnamed Road"
--                       takes 80 works, and "France" takes 190
--   without the country "Canada" wins 902 names, lands on Vancouver's own coordinate and
--   test                shadows Vancouver itself off the list
--   without the hint    "Mini Hollywood", "Bryant Park", "Tate Modern" and "Bonneville
--   count               Salt Flats" each arrive with 40-53 works looking like small towns
--   without the         at a 20 km radius Westminster, Lambeth, St. James's and City of
--   shadowing rule      Westminster each return the SAME 656 works as London
--   with the mean       the anchor for "Paris" lands in the Atlantic; with the densest
--   or the densest      point, London moves to Greenwich, where 51 rows share one
--   point instead       coordinate. The median survives both.
--
-- Known limits, both stated rather than papered over. The list is Anglo-American because
-- the sources are — Prague, Rome and Vienna hold too few rows to clear the first rule. And
-- Paris fails the spread test because two thirds of the rows naming it are Paris, Texas
-- and Paris, Ontario; it is added to the gazetteer by hand and marked there, because
-- loosening the threshold enough to admit it also admits "s/n" (Spanish for "no street
-- number"), which was measured to take 87 works and shadow Madrid.

with parts as materialized (
  -- Every comma-separated component of every located row's address is a candidate name.
  -- Anything carrying a digit is a house number or a postcode, not a city.
  select
    p.lat, p.lng, p.work_id,
    btrim(p.area_hint) as hint,
    btrim(t.part) as name,
    t.ord,
    array_length(string_to_array(btrim(p.area_hint), ','), 1) as n
  from location_submissions p,
       lateral unnest(string_to_array(btrim(p.area_hint), ',')) with ordinality as t(part, ord)
  where p.lat is not null
    and p.status <> 'rejected'
    and not (p.lat = 0 and p.lng = 0)
    and btrim(t.part) !~ '[0-9]'
    and length(btrim(t.part)) between 3 and 30
),

-- Rule 1. A country is the component that comes LAST. Nothing about the word says so —
-- this is measured, and it separates cleanly: Canada 1.000, France 0.912, Ireland 0.813
-- against Vancouver 0.000, Madrid 0.000, Almería 0.000.
tail as materialized (
  select name, count(*) filter (where ord = n)::numeric / count(*) as country_share
  from parts group by name having count(*) >= 8
),

cand as materialized (
  select
    p.name,
    -- Rule 3. The MEDIAN of its own points. A third of everything called "Paris" is in
    -- Texas or Ontario and the median is still in the 4th arrondissement.
    percentile_cont(0.5) within group (order by p.lat) as lat,
    percentile_cont(0.5) within group (order by p.lng) as lng,
    (percentile_cont(0.75) within group (order by p.lat)
     - percentile_cont(0.25) within group (order by p.lat)) * 111.0 as iqr_lat_km,
    (percentile_cont(0.75) within group (order by p.lng)
     - percentile_cont(0.25) within group (order by p.lng)) * 111.0
      * cos(radians(percentile_cont(0.5) within group (order by p.lat))) as iqr_lng_km,
    count(distinct p.work_id) as named_works,
    mode() within group (order by case when p.n > 1 then btrim((string_to_array(p.hint, ','))[p.n]) end) as country
  from parts p
  join tail t on t.name = p.name and t.country_share < 0.8
  group by p.name
  having count(distinct p.work_id) >= 8
     -- Rule 2. An area is written many ways; one address is written one way. This is what
     -- separates a small town from a single famous venue.
     and count(distinct lower(p.hint)) >= 3
),

-- Rule 4. A name that means several places does not get one page. Interquartile rather
-- than full spread, so a handful of homonyms cannot veto a real city.
clean as (
  select * from cand where iqr_lat_km <= 50 and abs(iqr_lng_km) <= 50
),

-- Rule 5. Of two candidates within 40 km, only the more-named survives. 40 is twice the
-- 20 km page radius, so the surviving discs cannot overlap and no film is ever counted
-- into two cities.
accepted as (
  select c.* from clean c
  where not exists (
    select 1 from clean o
    where o.name <> c.name
      and o.named_works > c.named_works
      and 111.0 * sqrt(power(o.lat - c.lat, 2)
                     + power((o.lng - c.lng) * cos(radians(c.lat)), 2)) <= 40
  )
)

-- Printed as the JavaScript object the gazetteer holds, so the paste is mechanical.
select
  format(
    '  { name: %L, country: %L, lat: %s, lng: %s },  // %s works, %s points',
    a.name, a.country,
    round(a.lat::numeric, 4), round(a.lng::numeric, 4),
    count(distinct s.work_id), count(*)
  ) as entry
from accepted a
join location_submissions s
  on s.lat is not null
 and s.status <> 'rejected'
 and not (s.lat = 0 and s.lng = 0)
 and 111.0 * sqrt(power(s.lat - a.lat, 2)
                + power((s.lng - a.lng) * cos(radians(a.lat)), 2)) <= 20
group by a.name, a.country, a.lat, a.lng, a.named_works
-- Rule 6. A city with fewer than ten films is not something to browse. It is not hidden
-- either: its places are still on the map and its films are still in the A-Z.
having count(distinct s.work_id) >= 10
order by count(distinct s.work_id) desc;
