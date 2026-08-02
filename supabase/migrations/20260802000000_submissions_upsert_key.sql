-- Make the submissions queue actually upsertable (#47).
--
-- The unique index was built on an EXPRESSION, `lower(btrim(place_name))`. That
-- correctly stops "Hankley Common" and "hankley common" becoming two rows, but
-- PostgREST's on_conflict takes column NAMES, and a column list cannot match an
-- expression index. Every write from the enrichment script failed with
--
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- after the model call had already been spent — the most expensive place to discover it.
--
-- The fix keeps the normalisation and makes it addressable: a stored generated column
-- holds the normalised name, and the uniqueness lives on a plain column pair. Generated
-- rather than written by the application, so a second writer cannot skip it.

alter table location_submissions
  add column if not exists place_key text
  generated always as (lower(btrim(place_name))) stored;

-- The expression index is now redundant with the constraint below, and leaving both
-- means two index writes per row for one guarantee.
drop index if exists location_submissions_unique_idx;

alter table location_submissions
  drop constraint if exists location_submissions_work_place_key;

alter table location_submissions
  add constraint location_submissions_work_place_key unique (work_id, place_key);
