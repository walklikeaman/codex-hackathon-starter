-- Every stored fact says where it came from. Enforced by the database, not by habit.
--
-- Per Nikita 2026-08-05: when we enrich, we must keep the source — which site, which
-- page — so a claim can always be traced back.
--
-- This was already the convention and it was already broken. Measured before writing
-- this: 92 links in `work_place_links`, of which **8 carried no evidence row at all**.
-- Checked against Wikidata, five of the eight correspond to real P840 statements
-- (Skyfall→London, →Istanbul, →Shanghai) and three do not exist there at all —
-- Skyfall→Hashima Island, Skyfall→National Gallery, Harry Potter→London Zoo.
--
-- Those three are probably TRUE. Hashima is the acknowledged model for Silva's island
-- and the zoo is the snake scene. And that is exactly the point: with no recorded
-- source there is no way to tell a right row from a wrong one, and "probably true"
-- is the state this project exists to refuse.

-- 1. A source must be IDENTIFIABLE. A URL for a page, or a reference for a statement
--    (a Q-id, a TMDB id, an image id) — one or the other, never neither. `agrees` and
--    `snippet` describe a source; they cannot stand in for one.
alter table place_evidence
  drop constraint if exists place_evidence_has_source;

alter table place_evidence
  add constraint place_evidence_has_source check (
    (source_url is not null and length(btrim(source_url)) > 0)
    or (source_ref is not null and length(btrim(source_ref)) > 0)
  ) not valid;

-- `not valid` deliberately: it binds every new and updated row while leaving history
-- readable. Validating it would fail on rows nobody can now source, and deleting those
-- would destroy facts that are probably correct — the honest state is visible debt.

-- 2. A link must carry at least one piece of evidence, checked AT COMMIT so that the
--    link and its evidence can be written in one transaction, which is how they are
--    actually written.
create or replace function require_link_evidence() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from place_evidence
    where subject_type = 'link' and subject_id = new.id
  ) then
    raise exception
      'work_place_links %: a link must record where it came from (no place_evidence row)',
      new.id
      using hint = 'Insert the place_evidence row in the same transaction.';
  end if;
  return null;
end;
$$;

drop trigger if exists work_place_links_require_evidence on work_place_links;

create constraint trigger work_place_links_require_evidence
  after insert or update on work_place_links
  deferrable initially deferred
  for each row execute function require_link_evidence();

-- 3. The debt is queryable rather than invisible. A rule whose violations cannot be
--    listed is a rule nobody can pay off.
create or replace view links_without_evidence as
  select l.id, l.work_id, l.place_id, l.relation_kind, l.created_at
  from work_place_links l
  where not exists (
    select 1 from place_evidence e
    where e.subject_type = 'link' and e.subject_id = l.id
  );

comment on view links_without_evidence is
  'Links stored before provenance was enforced. Source them or remove them; do not invent a source.';
