-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- What a movie-locations.com submission owes.
--
-- Its film slug and caption index, and the caption itself. The caption demand
-- matches reelstreets and for a related reason: the place was cut out of a
-- sentence, and a reviewer must be able to see the sentence it came from. The
-- difference is that here a regex did the cutting rather than a model, which is
-- more predictable but no more self-evidently right.

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
      when 'reelstreets' then
        source_record_id is not null
        and length(btrim(source_record_id)) > 0
        and source_sentence is not null
        and length(btrim(source_sentence)) >= 10
      when 'movielocations' then
        source_record_id is not null
        and length(btrim(source_record_id)) > 0
        and source_sentence is not null
        and length(btrim(source_sentence)) >= 10
      else false
    end
  );
