-- A place must be reviewed before it appears on the map (#48).
--
-- Today every place in the graph came from a Wikidata statement, so the map is safe by
-- accident rather than by design: nothing has ever tried to put an unverified place in
-- it. The moment an AI-discovered or community-submitted location can persist, that
-- accident ends — so the gate goes in first, while the table is still clean.
--
-- The issue proposed gating on the vision frame-matcher. Measured, that matcher returns
-- ZERO matches even for Skyfall and Harry Potter against well-photographed landmarks,
-- because a film's TMDB gallery is marketing material rather than a location survey
-- (see wiki/concepts/film-frames.md). A gate that admits nothing is not quality
-- control, it is an off switch — so the status is the deliverable here, and the
-- verifier that fills it is chosen separately from evidence that actually exists.

do $$ begin
  create type place_review_status as enum ('pending', 'verified', 'rejected');
exception when duplicate_object then null;
end $$;

alter table places
  -- `pending` is the default precisely because the risky path is the one that has not
  -- been written yet: anything inserted without an explicit opinion stays off the map.
  add column if not exists status place_review_status not null default 'pending',
  add column if not exists status_reason text,
  add column if not exists reviewed_at timestamptz;

comment on column places.status is
  'Review state. Only `verified` places are drawn. New rows default to `pending` so an unreviewed insert cannot reach the map by omission.';

-- Backfill: every existing place is grounded in a canonical Wikidata statement, which
-- IS the verification. Written explicitly rather than by changing the default, so the
-- claim "these were checked" is recorded rather than assumed.
update places
set status = 'verified',
    status_reason = 'Grounded in a canonical Wikidata statement (backfill 2026-07-28).',
    reviewed_at = now()
where status = 'pending'
  and wikidata_id is not null
  and exists (
    select 1 from place_evidence e
    where e.subject_type = 'place' and e.subject_id = places.id and e.agrees is not false
  );

create index if not exists places_pending_idx on places (status) where status = 'pending';

-- The gate. Signature deliberately UNCHANGED: eight call sites share it, and adding a
-- parameter would create an overload that leaves the old, ungated version callable —
-- a trap this project has already fallen into once. The status is read from the row
-- the id already identifies.
create or replace function place_is_mappable(
  p_lat double precision, p_place_class place_class, p_confidence numeric, p_place_id uuid
)
returns boolean
language sql stable
as $$
  select p_lat is not null
     and p_place_class <> 'fictional'
     and p_confidence >= 0.4
     and exists (
       select 1 from places p
       where p.id = p_place_id and p.status = 'verified'
     )
     and exists (
       select 1 from place_evidence e
       where e.subject_type = 'place' and e.subject_id = p_place_id and e.agrees is not false
     );
$$;
