-- The catalogue, small enough to download, so a personal library never has to be uploaded.
--
-- Reported from a real import: a 2,422-film Letterboxd ZIP produced "0 mapped titles". The
-- ZIP parsed fine; the count was computed against the works belonging to the locations
-- loaded for the CITY IN VIEW — eleven of them — so zero was the arithmetically correct
-- answer to a question nobody asked. Measured the same day: **6,075 works have at least
-- one located row**, and that is the number a library should be compared with.
--
-- Matching could be done server-side, and it must not be. The import panel promises "The
-- ZIP or CSV is processed locally and is never uploaded", and posting 2,422 titles to be
-- matched would break that for the one feature whose whole appeal is that it does not. So
-- the catalogue travels to the library instead: title, year, identifiers and a place count,
-- which is a couple of hundred kilobytes before compression.
--
-- `place_count` counts rows that are NOT rejected, so a work whose only submissions were
-- refused as non-places does not appear at all — otherwise a library would be told we hold
-- a film whose every location is "Google Maps".

create or replace view catalogue_index as
  select
    w.id,
    w.title_norm,
    w.year,
    w.kind,
    w.imdb_id,
    w.tmdb_id,
    count(*) filter (where s.lat is not null)::int as place_count
  from works w
  join location_submissions s
    on s.work_id = w.id
   and s.status <> 'rejected'
  group by w.id, w.title_norm, w.year, w.kind, w.imdb_id, w.tmdb_id
  having count(*) filter (where s.lat is not null) > 0;

alter view catalogue_index set (security_invoker = true);

comment on view catalogue_index is
  'Works with at least one located, unrejected submission. Downloaded whole so a personal library can be matched in the browser without ever being uploaded.';
