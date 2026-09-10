-- What a Fandom row must carry before the table will accept it.
--
-- `location_submissions_evidence_for_kind` ends in `ELSE false`, so a new source is
-- refused until it says what evidence it brings. That is the constraint working as
-- designed and it caught a real gap: the ingest was keeping the revision id inside the
-- permalink string and nowhere a query could reach it.
--
-- Fandom is held to Wikipedia's rule, because it is the same kind of source — an editable
-- page whose text is the claim:
--
--   source_sentence  the wording the card prints, so a row cannot arrive as a bare name
--   source_revid     the revision the claim was read at
--
-- The revision is the whole difference between a citation and a link. A fan wiki changes
-- under you; "somebody wrote this on this page at some point" is not checkable, and
-- `?oldid=<revid>` is. Unlike Wikipedia, Fandom is also where an anonymous edit can move a
-- location overnight, which makes the pinned revision more important here, not less.

alter table location_submissions
  drop constraint if exists location_submissions_evidence_for_kind;

alter table location_submissions
  add constraint location_submissions_evidence_for_kind check (
    case source_kind
      when 'wikipedia' then (source_sentence is not null and length(btrim(source_sentence)) >= 10
                             and source_revid is not null and source_revid > 0)
      when 'permit_record' then (source_record_id is not null and length(btrim(source_record_id)) > 0)
      when 'moviemaps' then (source_record_id is not null and length(btrim(source_record_id)) > 0)
      when 'reelstreets' then (source_record_id is not null and length(btrim(source_record_id)) > 0
                               and source_sentence is not null and length(btrim(source_sentence)) >= 10)
      when 'movielocations' then (source_record_id is not null and length(btrim(source_record_id)) > 0
                                  and source_sentence is not null and length(btrim(source_sentence)) >= 10)
      when 'open_plaques' then (source_record_id is not null and length(btrim(source_record_id)) > 0
                                and source_sentence is not null and length(btrim(source_sentence)) >= 10)
      when 'fandom' then (source_sentence is not null and length(btrim(source_sentence)) >= 10
                          and source_revid is not null and source_revid > 0)
      else false
    end
  );
