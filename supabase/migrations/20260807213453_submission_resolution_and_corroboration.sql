-- Two things a submission can gain after it arrives, and neither is a rewrite of
-- what it claimed.
--
-- 1. A Wikidata entity, found by asking WDQS what sits at the submission's own
--    coordinate under its own name. Measured on 196 pins: 28.1% resolve, and the
--    ceiling is the data rather than the rule — Wikidata holds notable places,
--    and a great many filming locations are ordinary houses. This matters
--    because place-review.mjs weights wikidata_entity at 0.6 against a 0.6
--    threshold, so a canonical entity is the ONLY single signal that verifies,
--    and not one of 44,088 submissions had one.
--
-- 2. Corroboration from another source. Three scrapes name the same address for
--    the same film independently; that agreement is evidence the schema had no
--    way to record. It is ALSO how a coordinate travels: moviemaps carries
--    30,153 points, reelstreets and movie-locations carry almost none, and
--    13,819 rows are refused by the review gate before any scoring purely for
--    having no point.
--
-- Both are separate columns rather than folded into lat/lng, because a borrowed
-- coordinate is a different fact from a contributor's own and must stay tellable
-- apart. geocode_source already carries that distinction; these say where the
-- borrowing came from.

alter table location_submissions
  add column if not exists wikidata_id text,
  -- [{"source_kind": "moviemaps", "submission_id": "…", "place_name": "…",
  --   "gave_coordinate": true}]
  add column if not exists corroborated_by jsonb;

comment on column location_submissions.wikidata_id is
  'Q-id found at this submission''s own coordinate under its own name. Null = not resolved, which for an ordinary house is the permanent answer.';
comment on column location_submissions.corroborated_by is
  'Independent sources naming this place for this work. Agreement between scrapes, not a second opinion from one.';

-- A Q-id must look like one. Cheap, and it catches a resolver writing a label
-- or a URL into the column.
alter table location_submissions
  drop constraint if exists location_submissions_wikidata_shape;
alter table location_submissions
  add constraint location_submissions_wikidata_shape check (
    wikidata_id is null or wikidata_id ~ '^Q[1-9][0-9]*$'
  );

create index if not exists location_submissions_wikidata_idx
  on location_submissions (wikidata_id) where wikidata_id is not null;
create index if not exists location_submissions_corroborated_idx
  on location_submissions (source_kind) where corroborated_by is not null;
