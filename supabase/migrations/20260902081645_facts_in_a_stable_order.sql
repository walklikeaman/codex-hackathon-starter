-- Two facts that look the same must at least arrive in the same order every time.
--
-- Found while rendering the place card (#129, step 4) against production. London holds four
-- Skyfall facts: one filming fact and three narrative facts, one per scene. `place_facts_at`
-- orders by distance and then subject name — which ties on all four — so PostgreSQL was free
-- to return them in whatever order the scan produced, and did: scene 9, the filming fact,
-- scene 2, scene 7. Reload and it may differ.
--
-- That is worse here than untidiness. The page's whole claim is that these are four distinct
-- facts rather than one printed four times, and a list that reorders itself between reloads
-- is the strongest possible argument that it is a rendering accident.
--
-- `work_facts` ties in exactly the same way — it orders by distance and place name, and all
-- four of those rows carry the place name "London". So both ends of one table could order
-- the same four facts differently, which is precisely the disagreement #129's last
-- acceptance line rules out. Both are fixed here, and both tie-break the same way:
--
--   narrative_order nulls first — the filming fact is about the film, the scenes are within
--   it, so "where it was shot" comes before "scene 2";
--   stated_year, then fact_id — the last is arbitrary and that is the point: an arbitrary
--   key applied consistently is a stable order, and no two facts share one.
--
-- Nothing about which rows come back changes. Only whether the answer is the same twice.

create or replace function work_facts(p_work_id uuid)
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
  order by
    fact_distance(f.subject_type, f.relation_kind),
    p.name,
    f.narrative_order nulls first,
    f.stated_year,
    f.fact_id
$$;

comment on function work_facts(uuid) is
  'The work card in one query: the work''s facts plus its creators'' facts, each with its place and its distance from the work.';

create or replace function place_facts_at(p_place_id uuid)
returns table (
  fact_id uuid,
  subject_type text,
  subject_id uuid,
  subject_name text,
  subject_kind text,
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
  select
    f.fact_id, f.subject_type, f.subject_id, f.subject_name, f.subject_kind,
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
  from place_facts f
  join places p on p.id = f.place_id
  where f.place_id = p_place_id
  -- Distance first, so "filmed here" is never printed under "nearby, and here is why";
  -- then the subject's name, so the order of two films at one doorway is stable rather
  -- than whatever the union happened to emit; then the scene, so one film's four facts
  -- at one place are stable too.
  order by
    fact_distance(f.subject_type, f.relation_kind),
    f.subject_name,
    f.narrative_order nulls first,
    f.stated_year,
    f.fact_id
$$;

comment on function place_facts_at(uuid) is
  'The place card in one query: every fact at this place, from any work or person, with its distance and its evidence count.';
