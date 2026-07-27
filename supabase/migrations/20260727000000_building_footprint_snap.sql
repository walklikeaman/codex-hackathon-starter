-- Snapping a place onto the OSM building footprint it refers to (#45).
--
-- The snapped point replaces lat/lng so every existing query, the generated
-- `centroid` and the map all keep working unchanged. The point we were given BEFORE
-- the snap is kept alongside it, because a moved pin is a claim and a claim we cannot
-- show our working for is exactly what this project refuses to display. Keeping the
-- original also makes the move reversible without re-geocoding.

alter table places
  -- The OSM way/relation we matched, e.g. "way/39814415". Also the audit trail: it
  -- can be opened on openstreetmap.org and checked by hand.
  add column if not exists osm_building_id text,
  -- The footprint ring, so the map can outline the building instead of only pinning
  -- it. Stored as jsonb [{lat,lng},…] rather than PostGIS geometry: it is displayed
  -- verbatim and never queried spatially.
  add column if not exists footprint jsonb,
  -- Where the geocoder put us, before we moved the pin.
  add column if not exists pre_snap_lat double precision,
  add column if not exists pre_snap_lng double precision,
  add column if not exists snapped_at timestamptz;

comment on column places.osm_building_id is
  'OSM way/relation id of the matched building footprint (ODbL — attribution required wherever a snapped coordinate is shown).';
comment on column places.pre_snap_lat is
  'The geocoded latitude before the building snap moved the pin. Never overwritten, so the move stays auditable and reversible.';

-- Finding places still worth snapping: anything vaguer than a building that has not
-- been tried yet. Partial, because snapped rows are the majority once this has run
-- and there is no reason to index them.
create index if not exists places_unsnapped_idx
  on places (geocode_precision)
  where osm_building_id is null
    and lat is not null
    and geocode_precision is distinct from 'building';

-- A snapped place must be able to prove it: the id, the original point and the time
-- all arrive together or not at all. A half-written snap would look identical to a
-- verified one while being unauditable.
alter table places drop constraint if exists places_snap_is_complete;
alter table places add constraint places_snap_is_complete check (
  osm_building_id is null
  or (pre_snap_lat is not null and pre_snap_lng is not null and snapped_at is not null)
);
