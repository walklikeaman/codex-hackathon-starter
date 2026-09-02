-- Step 4 of #129: the place card, read from the end the work card does not use.
--
-- `place_facts` has existed since 08.08 and has had no reader. `work_facts(uuid)` enters it
-- from the work's end — this enters it from the place's, and that is the whole point of the
-- view: the two cards are one table read from opposite sides, so a place where Hitchcock and
-- Harry Potter both have a fact shows both instead of belonging to whichever work was asked
-- about first.
--
-- The shape mirrors `work_facts` deliberately, so `placeSummary()` in the client can shape a
-- row from either without knowing which end it came from. Two additions:
--
--   `subject_kind` — a work's card never needs it (every subject is that work); a place's
--   does, because the subjects here are a film, a series and a person, and the reader has to
--   be able to tell which before deciding whether the name is a link to a film card.
--
--   `work_count` is NOT here: it would be a count over the same rows the caller just
--   received, and a number computed twice from one source is a number that can disagree
--   with itself.
--
-- Two confidences again, and they are still not the same question. `fact_confidence` is how
-- sure we are of the CLAIM; `confidence` is the place's own grounding score — how sure we
-- are we know where it is. See [[three-axes]].

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
  -- than whatever the union happened to emit.
  order by fact_distance(f.subject_type, f.relation_kind), f.subject_name, f.stated_year
$$;

comment on function place_facts_at(uuid) is
  'The place card in one query: every fact at this place, from any work or person, with its distance and its evidence count.';
