-- The OSM way that confirmed a place stands on the street its name says (street-confirm.mjs).
--
-- A street has no footprint, so `osm_building_id` cannot hold it, and must not: a building
-- id is what the walkability check and the precision badge read as "a building". This is
-- the street's own column, set together with geocode_precision = 'street' and snapped_at,
-- and the pin is not moved. It also takes the place out of the building-snap queue: a pin
-- on a pavement is often inside the footprint beside it, and that is not evidence.

alter table public.places add column if not exists osm_street_id text;
