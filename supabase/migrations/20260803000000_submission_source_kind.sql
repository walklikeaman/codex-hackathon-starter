-- A submission says where it came from, and carries the evidence THAT KIND owes.
--
-- The queue was built around one source and its shape leaked into the columns:
-- `source_revid` and `source_sentence` are both NOT NULL, and both are Wikipedia
-- concepts. A city's filming-permit record has neither — it has a permit id, an
-- address and a date, issued by the authority that granted the shoot.
--
-- Worse, the licence carried a default:
--
--     source_license text not null default 'CC BY-SA 4.0'
--
-- which happened to be true while Wikipedia was the only writer and becomes a FALSE
-- STATEMENT IN THE DATABASE the moment anything else writes. Paris permit data is
-- ODbL, which is share-alike on the database itself — a licence you cannot infer, and
-- must not default.
--
-- So: name the kind, drop the default, and require of each kind the evidence that kind
-- actually has. A permit record is not weaker evidence than a sentence; it is a
-- different sort, and a schema that can only express one was going to force the other
-- into a lie.

create type submission_source_kind as enum ('wikipedia', 'permit_record');

alter table location_submissions
  add column if not exists source_kind submission_source_kind not null default 'wikipedia',
  -- The record's own identifier at the issuing authority, so a row can be traced back
  -- to the permit rather than to a page that mentions it.
  add column if not exists source_record_id text,
  add column if not exists source_license_url text,
  -- Rendered wherever the pin is shown. ODbL and CC BY-SA oblige different words, and
  -- the obligation belongs to the row, not to a constant in the UI.
  add column if not exists source_attribution text;

-- Every existing row IS a Wikipedia row, and its licence was true. Say so explicitly
-- before removing the default that was saying it for them.
update location_submissions
  set source_license = 'CC BY-SA 4.0'
  where source_license is null;

alter table location_submissions
  alter column source_license drop default;

-- Wikipedia concepts, and only Wikipedia rows have them.
alter table location_submissions
  alter column source_revid drop not null,
  alter column source_sentence drop not null;

alter table location_submissions
  drop constraint if exists location_submissions_has_source,
  drop constraint if exists location_submissions_real_revid;

-- The rule the two NOT NULLs were really trying to express: a submission is only worth
-- reviewing if it brings the evidence its own kind is supposed to bring.
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
    end
  );

-- Reviewing by source is the first thing anyone will want: permit records are strong
-- enough to wave through in bulk, prose claims are not.
create index if not exists location_submissions_kind_idx
  on location_submissions (source_kind, status);
