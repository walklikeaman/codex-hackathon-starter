-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- What a reelstreets.com submission owes.
--
-- Its film id and capture index, so a row leads back to the one shot it came
-- from rather than to a page that holds thirty of them.
--
-- And, unlike the other kinds, its caption. ReelStreets writes prose and a model
-- read the place out of it; the sentence is the evidence and the extraction is
-- only a convenience, so a row that arrives without the sentence has nothing a
-- reviewer can check the extraction against. That is a real risk here and not in
-- the other three, which is why this branch demands more than theirs.

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
      else false
    end
  );
