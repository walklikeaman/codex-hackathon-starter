-- Recovered from the live database on 2026-08-05: applied through the Supabase MCP by
-- another session and never committed. Text below is exactly what ran (version
-- 20260805003954).

-- What a moviemaps.org submission owes, and the hole that let it owe nothing.
--
-- The evidence rule from 20260803000000 is a CASE over source_kind with no ELSE. A CASE
-- that matches nothing returns NULL, and a CHECK constraint treats NULL as PASSED. So
-- the moment 'moviemaps' became a legal enum value, every moviemaps row satisfied the
-- evidence rule by not being mentioned in it.

alter table location_submissions
  drop constraint if exists location_submissions_evidence_for_kind;

alter table location_submissions
  add constraint location_submissions_evidence_for_kind check (
    case source_kind
      when 'wikipedia' then
        source_sentence is not null
        and length(btrim(source_sentence)) >= 10
        and source_revid is not null
        and source_revid > 0
      when 'permit_record' then
        source_record_id is not null
        and length(btrim(source_record_id)) > 0
      when 'moviemaps' then
        source_record_id is not null
        and length(btrim(source_record_id)) > 0
      else false
    end
  );

-- Frames, for the REVIEWER -- not for the product. Stored as links, never as bytes,
-- and never in work_images: that table holds the TMDB gallery the product renders.
alter table location_submissions
  add column if not exists source_media jsonb;

comment on column location_submissions.source_media is
  'Evidence images for review, as links to the source. Not licensed for display in the product.';
