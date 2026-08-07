-- A fifth kind of submission: movie-locations.com.
--
-- Alone in its own migration, as with moviemaps and reelstreets: Postgres
-- refuses to USE a new enum value in the transaction that created it.
alter type submission_source_kind add value if not exists 'movielocations';
