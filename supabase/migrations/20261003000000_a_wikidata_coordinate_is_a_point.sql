-- A coordinate the geocoder took from a Wikidata entity is that entity's point.
--
-- Promotion called a place `point` only when its submission carried `wikidata_id`. A row
-- the geocoder resolved through Wikidata carries the entity in `geocode_source_id`
-- instead, and was promoted as `none` — "we hold a point and make no claim about what it
-- is a point OF" — about a coordinate that is exactly Q193375's own, for Tate Modern.
-- Measured on 2026-10-03: 162 of the 1,059 `none` places sit on such a coordinate.
--
-- Only a place that still sits exactly where that row put it: a place since moved by a
-- building snap or by hand is described by what moved it, not by this.

update public.places as p
set geocode_precision = 'point'
where p.geocode_precision = 'none'
  and exists (
    select 1
    from public.location_submissions s
    where s.place_id = p.id
      and s.geocode_source = 'wikidata'
      and s.geocode_source_id ~ '^Q[1-9][0-9]*$'
      and abs(s.lat - p.lat) < 1e-6
      and abs(s.lng - p.lng) < 1e-6
  );
