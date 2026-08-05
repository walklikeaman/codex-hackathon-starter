-- A third kind of submission: moviemaps.org.
--
-- This migration adds the enum value and NOTHING else, which is not tidiness. Postgres
-- refuses to use a new enum value in the same transaction that created it:
--
--   ERROR: unsafe use of new value "moviemaps" of enum type submission_source_kind
--
-- and the evidence CHECK in 20260803000000 names every kind. Adding the value and
-- extending the check in one file fails on a clean database while appearing to work on
-- one where the value already exists. So the check lives in the next migration, which
-- is a separate transaction.

alter type submission_source_kind add value if not exists 'moviemaps';
