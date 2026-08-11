-- What a plaque submission owes.
--
-- The evidence rule is a CASE over source_kind with an ELSE of false, so a new kind owes
-- nothing until it is named here — and the moment 'open_plaques' became legal, every
-- plaque row would have been rejected outright. (The opposite failure, a CASE with no
-- ELSE returning NULL and a CHECK treating NULL as passed, is what 20260805003954 fixed.)
--
-- A plaque owes MORE than the other sources, and can afford to: the sentence is cast in
-- metal on a wall at a known address. So both are required — the plaque's own id, and
-- the inscription itself. Not a summary of it: the value of this source is that anybody
-- standing in front of the wall can check the quote.
--
-- The branches for `reelstreets` and `movielocations` are carried over from the LIVE
-- definition rather than from this repository. Another session added them through the
-- MCP without committing the migration, and rewriting the constraint from what the repo
-- knew would have dropped them — the first attempt did exactly that and was rejected by
-- 8,063 existing rows. A constraint is written against the database that exists.

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
      when 'open_plaques' then
        source_record_id is not null
        and length(btrim(source_record_id)) > 0
        and source_sentence is not null
        and length(btrim(source_sentence)) >= 10
      else false
    end
  );
