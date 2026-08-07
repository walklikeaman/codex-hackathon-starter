-- A fact has its own identity, its own payload and its own sentence (#129).
--
-- A work has many facts; a fact has a place; a place has many facts, from different works
-- and different people. The schema expressed half of that. Three things are fixed here,
-- and one of them was not a design flaw but a live outage.
--
-- ---------------------------------------------------------------------------------------
-- THE OUTAGE, measured before anything else was written
--
-- 20260731234121_scene_links_allow_revisits replaced
--
--   unique (work_id, place_id, relation_kind)
--
-- with two PARTIAL unique indexes, one of them `where scene_id is null`. The reasoning in
-- that migration is sound about NULLs on Postgres 14 and it missed one thing: PostgREST
-- sends `ON CONFLICT (work_id, place_id, relation_kind)` with no WHERE clause, and Postgres
-- cannot infer a partial index from a bare inference clause. Probed against production on
-- 2026-08-08:
--
--   ERROR 42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--   specification
--
-- `/api/resolve` — the only write path into the canonical graph — has therefore been dead
-- since 31 July. The graph has stood at 92 links and 70 places while the review queue grew
-- to 44,098 rows, and nothing reported it, because the route fails on the upsert after the
-- Wikidata round-trips have already succeeded.
--
-- The fix is a FULL index with `nulls not distinct`, which Postgres 15 gained and this
-- database (17.6) has. It gives back inference AND keeps the guarantee the split existed to
-- protect: two scene-less rows for the same triple still collide, because their NULLs are
-- no longer distinct.
--
-- ---------------------------------------------------------------------------------------
-- BREAK 1: one row per (work, place, kind) forbids a second fact of the same kind
--
-- Abbey Road plus The Beatles plus "recorded here" is one row for twelve recordings, each
-- with its own year and its own source. Two scenes shot in one building are two facts and
-- one row. Uniqueness over the triple made sense while a fact meant "this work is somehow
-- connected to this place"; with music (#128) and plaques (#125) the source states a
-- specific claim with a date, and the claim is the thing worth storing.
--
-- So a fact gains a payload — what exactly, in what year — and `about` joins the
-- uniqueness key. Two facts of the same kind at the same place are now legal when they are
-- about different things, and still illegal when they are about the same thing.
--
-- ---------------------------------------------------------------------------------------
-- BREAK 2: a fact about a person is pinned to a work
--
-- "The director lived here" is a fact about a PERSON; it reaches the film through the
-- person. Today `author_place` hangs off work_id, so the café where Rowling wrote is seven
-- rows — one per book — with the same evidence copied seven times, and adding the eighth
-- book means copying it again. `work_creators` exists; `creator_place_links` did not.
--
-- ---------------------------------------------------------------------------------------
-- AND THE SENTENCE
--
-- The card's wording is assembled in code from the relation kind (`placeRole` in
-- work-profile.mjs). That was the only option while a fact was a bare Wikidata triple. A
-- plaque hands us the whole sentence already written on the wall, and reducing
--
--   "J. K. Rowling wrote some of the early chapters of Harry Potter in the rooms on the
--    first floor of this building"
--
-- to "Where the author worked" throws away the only part a visitor came for. A fact now
-- stores its own wording; the template becomes the fallback, not the rule.

-- ---------- 1. a fact says what it claims ----------

alter table work_place_links add column if not exists about text;
alter table work_place_links add column if not exists stated_year integer;
alter table work_place_links add column if not exists statement text;

-- '' and NULL must not be two different ways of saying "no payload": they would be two
-- different rows under the uniqueness key below, which is how duplicate pins are born.
alter table work_place_links drop constraint if exists work_place_links_about_shape;
alter table work_place_links add constraint work_place_links_about_shape
  check (about is null or length(btrim(about)) > 0);

alter table work_place_links drop constraint if exists work_place_links_statement_shape;
alter table work_place_links add constraint work_place_links_statement_shape
  check (statement is null or length(btrim(statement)) > 0);

comment on column work_place_links.about is
  'What exactly this fact is about at this place: an album, an episode, a scene. NULL = the work as a whole. Part of the uniqueness key, so two facts of the same kind must differ here.';
comment on column work_place_links.stated_year is
  'The year the SOURCE states, not the year of the work. A plaque that says 1924-1949 states a range; store the year the claim actually names or nothing.';
comment on column work_place_links.statement is
  'The sentence the source states, verbatim. NULL means we have no wording of our own and the card must fall back to its template.';

-- ---------- 2. one uniqueness rule, and PostgREST can name it ----------

create unique index if not exists work_place_links_fact_idx
  on work_place_links (work_id, place_id, relation_kind, scene_id, about)
  nulls not distinct;

-- Subsumed by the index above: (w, p, k) with scene_id and about both NULL is a prefix of
-- it, and NULLs no longer compare as distinct.
drop index if exists work_place_links_work_place_idx;

-- work_place_links_scene_idx (unique on scene_id where not null) is deliberately KEPT.
-- Two places for one scene is a real thing — an exterior and an interior — but `work_scenes`
-- left-joins scene to link and would silently return the scene twice. That is a trail
-- change, not a fact-architecture change, and it belongs to whoever makes it.

-- ---------- 3. a fact about a person ----------

create table if not exists creator_place_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references creators(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  relation_kind relation_kind not null,
  about text,
  stated_year integer,
  statement text,
  confidence numeric(4, 3) not null default 0,
  created_at timestamptz not null default now(),
  constraint creator_place_links_about_shape
    check (about is null or length(btrim(about)) > 0),
  constraint creator_place_links_statement_shape
    check (statement is null or length(btrim(statement)) > 0),
  -- A person cannot be a filming location. Without this the table accepts
  -- (Rowling, Alnwick Castle, filming_location), which reads as a claim nobody made.
  constraint creator_place_links_person_relation check (
    relation_kind in (
      'lived_here', 'worked_here', 'wrote_here', 'died_here', 'buried_here',
      'commemorated_here', 'author_place', 'artist_place'
    )
  )
);

create unique index if not exists creator_place_links_fact_idx
  on creator_place_links (creator_id, place_id, relation_kind, about)
  nulls not distinct;
create index if not exists creator_place_links_place_idx on creator_place_links (place_id);
create index if not exists creator_place_links_creator_idx on creator_place_links (creator_id);

comment on table creator_place_links is
  'A fact about a person at a place. Reaches a work through work_creators, so one cafe is one row however many books the author wrote there.';

-- ---------- 4. evidence hangs off a person fact too ----------

alter table place_evidence drop constraint if exists place_evidence_subject_type_check;
alter table place_evidence add constraint place_evidence_subject_type_check
  check (subject_type in ('place', 'link', 'scene', 'creator_link'));

-- The same contract 20260805010000 gave work facts: no source, no fact. Checked at COMMIT
-- so the fact and its evidence can be written in one transaction, which is how they are
-- actually written.
create or replace function require_creator_link_evidence() returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
begin
  if not exists (
    select 1 from place_evidence
    where subject_type = 'creator_link' and subject_id = new.id
  ) then
    raise exception
      'creator_place_links %: a fact must record where it came from (no place_evidence row)',
      new.id
      using hint = 'Insert the place_evidence row in the same transaction.';
  end if;
  return null;
end;
$$;

drop trigger if exists creator_place_links_require_evidence on creator_place_links;

create constraint trigger creator_place_links_require_evidence
  after insert or update on creator_place_links
  deferrable initially deferred
  for each row execute function require_creator_link_evidence();

alter table creator_place_links enable row level security;
drop policy if exists "graph read" on creator_place_links;
create policy "graph read" on creator_place_links for select using (true);

-- The debt stays queryable across BOTH kinds of fact. `links_without_evidence` is left
-- exactly as it is — the handoff measures against it (8 rows, must not grow) and moving
-- its goalposts in the same commit that adds a second table would make that number
-- unreadable.
create or replace view facts_without_evidence as
  select 'work'::text as subject_type, l.id as fact_id, l.work_id as subject_id,
         l.place_id, l.relation_kind::text as relation_kind, l.created_at
  from work_place_links l
  where not exists (
    select 1 from place_evidence e where e.subject_type = 'link' and e.subject_id = l.id
  )
  union all
  select 'creator'::text, c.id, c.creator_id,
         c.place_id, c.relation_kind::text, c.created_at
  from creator_place_links c
  where not exists (
    select 1 from place_evidence e where e.subject_type = 'creator_link' and e.subject_id = c.id
  );

alter view facts_without_evidence set (security_invoker = true);

comment on view facts_without_evidence is
  'Facts stored with no source. Source them or remove them; do not invent a source.';

-- ---------- 5. one table read from both ends ----------
--
-- The work card and the place card are the same rows entered from opposite sides, which is
-- the whole argument for a fact having an identity. Expressing that as one view means the
-- place card cannot drift away from the work card by being written twice.

create or replace view place_facts as
  select
    l.id           as fact_id,
    'work'::text   as subject_type,
    l.work_id      as subject_id,
    w.title        as subject_name,
    w.kind         as subject_kind,
    l.place_id,
    l.relation_kind::text as relation_kind,
    l.about,
    l.stated_year,
    l.statement,
    l.confidence,
    l.scene_id,
    l.narrative_order,
    l.created_at
  from work_place_links l
  join works w on w.id = l.work_id
  union all
  select
    c.id,
    'creator'::text,
    c.creator_id,
    cr.name,
    cr.kind,
    c.place_id,
    c.relation_kind::text,
    c.about,
    c.stated_year,
    c.statement,
    c.confidence,
    null::uuid,
    null::integer,
    c.created_at
  from creator_place_links c
  join creators cr on cr.id = c.creator_id;

alter view place_facts set (security_invoker = true);

comment on view place_facts is
  'Every fact at every place, from any work or person. The work card and the place card are this view read from opposite ends.';

-- ---------- 6. degree of separation, computed once ----------
--
-- The owner wants facts about the crew and about what influenced a work, and that is also
-- the main risk: "Harry Potter places" quietly becoming "places connected to anything
-- Rowling ever touched". So a fact always carries its distance from the work, and the
-- interface can decide what a route may contain instead of guessing.
--
--   0 — about the work itself: filmed here, set here, recorded here
--   1 — about its person: the director lived here, the author wrote here
--   2 — about what influenced it: the grave that gave a character its name
--
-- Defined in SQL, not in the client, because two surfaces disagreeing about what belongs
-- in a route is the same bug as two surfaces disagreeing about what a pin means.

create or replace function fact_distance(p_subject_type text, p_relation_kind text)
returns smallint
language sql immutable
set search_path = public, extensions, pg_catalog
as $$
  select case
    when p_relation_kind = 'inspiration_for' then 2::smallint
    when p_subject_type = 'creator' then 1::smallint
    -- The legacy shape: a person's place filed against a work because there was nowhere
    -- else to put it. Still distance 1 — it is a fact about a person either way.
    when p_relation_kind in ('author_place', 'artist_place') then 1::smallint
    else 0::smallint
  end
$$;

comment on function fact_distance(text, text) is
  'Degrees between a fact and the work it is shown under. 0 and 1 may enter a route; 2 is "nearby, and here is why".';

-- Everything the work card needs, in one call: the work's own facts, its people's facts,
-- the place each one is at, and how far from the work it is.
--
-- Two confidences, and they are not the same question. `fact_confidence` is how sure we
-- are that this CLAIM is true; `confidence` is the place's own grounding score — how sure
-- we are we know WHERE it is. The card sorts and badges by the second. Collapsing them
-- into one number is the mistake `three-axes` exists to prevent.
--
-- Dropped first: adding columns to the OUT list is a return-type change, and
-- `create or replace` will not do one.
drop function if exists work_facts(uuid);

create function work_facts(p_work_id uuid)
returns table (
  fact_id uuid,
  subject_type text,
  subject_id uuid,
  subject_name text,
  relation_kind text,
  about text,
  stated_year integer,
  statement text,
  distance smallint,
  fact_confidence numeric,
  scene_id uuid,
  narrative_order integer,
  place_id uuid,
  name text,
  city text,
  country text,
  lat double precision,
  lng double precision,
  place_class text,
  geocode_precision text,
  osm_building_id text,
  wikidata_id text,
  confidence numeric,
  evidence_count integer
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  with subject_facts as (
    select f.* from place_facts f
    where f.subject_type = 'work' and f.subject_id = p_work_id
    union all
    -- `exists`, not a join: work_creators is keyed by (work, creator, role), so a person
    -- who both wrote and directed would otherwise contribute every fact twice.
    select f.* from place_facts f
    where f.subject_type = 'creator'
      and exists (
        select 1 from work_creators wc
        where wc.work_id = p_work_id and wc.creator_id = f.subject_id
      )
  )
  select
    f.fact_id, f.subject_type, f.subject_id, f.subject_name,
    f.relation_kind, f.about, f.stated_year, f.statement,
    fact_distance(f.subject_type, f.relation_kind),
    f.confidence, f.scene_id, f.narrative_order,
    p.id, p.name, p.city, p.country, p.lat, p.lng, p.place_class::text,
    p.geocode_precision, p.osm_building_id, p.wikidata_id, p.confidence,
    (
      select count(*)::int from place_evidence e
      where e.subject_id = f.fact_id
        and e.subject_type = case f.subject_type when 'work' then 'link' else 'creator_link' end
    )
  from subject_facts f
  join places p on p.id = f.place_id
  order by fact_distance(f.subject_type, f.relation_kind), p.name
$$;

comment on function work_facts(uuid) is
  'The work card in one query: the work''s facts plus its creators'' facts, each with its place and its distance from the work.';
