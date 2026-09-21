-- Promoting a verified queue row has to be ONE transaction (#queue-review).
--
-- `work_place_links_require_evidence` is a deferrable constraint trigger: a link must have
-- its own `place_evidence` row by the time the transaction commits. PostgREST gives each
-- request its own transaction, so a client that inserts the link and then its evidence
-- fails on the first commit — which is what the first promotion run did:
--
--   work_place_links 8d99e797…: a link must record where it came from (no place_evidence row)
--
-- The rule is right and stays. What was wrong is asking a client to satisfy it across four
-- HTTP calls.
--
-- ---------------------------------------------------------------------------------------
--
-- The deciding — which rows are one place, what that place may claim — stays in
-- app/lib/promote-submission.mjs, where it is tested against real rows. This function only
-- writes what it is handed, in one go:
--
--   place → its evidence → one link per work → each link's own evidence → the submissions
--
-- `p_place_id` is passed when the caller matched an existing graph place, so a promotion
-- lands ON the 70 places we already hold rather than beside them.

create or replace function promote_place(
  p_place jsonb,
  p_place_id uuid,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_place_id uuid := p_place_id;
  v_work record;
  v_link_id uuid;
begin
  if v_place_id is null then
    insert into places (
      wikidata_id, name, lat, lng, place_class, geocode_precision,
      shot_on_set, confidence, confidence_band, status, status_reason
    )
    values (
      nullif(p_place->>'wikidata_id', ''),
      p_place->>'name',
      (p_place->>'lat')::double precision,
      (p_place->>'lng')::double precision,
      (p_place->>'place_class')::place_class,
      p_place->>'geocode_precision',
      (p_place->>'shot_on_set')::boolean,
      (p_place->>'confidence')::numeric,
      p_place->>'confidence_band',
      (p_place->>'status')::place_review_status,
      p_place->>'status_reason'
    )
    returning id into v_place_id;
  end if;

  -- What the place itself rests on: one row per submission, because the ledger's rule is
  -- one row = one signal. Re-running must not pile up copies of the same citation, so a
  -- source that is already recorded for this place is skipped.
  insert into place_evidence (subject_type, subject_id, method, source_url, source_ref, snippet, agrees)
  select 'place', v_place_id, 'text_mention',
         nullif(row_data->>'source_url', ''), nullif(row_data->>'source_kind', ''),
         left(nullif(row_data->>'snippet', ''), 500), true
    from jsonb_array_elements(p_rows) as row_data
   where not exists (
     select 1 from place_evidence e
      where e.subject_type = 'place' and e.subject_id = v_place_id
        and e.source_url is not distinct from nullif(row_data->>'source_url', '')
        and e.source_ref is not distinct from nullif(row_data->>'source_kind', '')
   );

  -- One link per work, and each link carries its own evidence — the same citations, filed
  -- against the claim they actually support: this film was shot at this place.
  for v_work in
    select (row_data->>'work_id')::uuid as work_id,
           max((row_data->>'confidence')::numeric) as confidence
      from jsonb_array_elements(p_rows) as row_data
     where nullif(row_data->>'work_id', '') is not null
     group by 1
  loop
    select id into v_link_id
      from work_place_links
     where work_id = v_work.work_id and place_id = v_place_id
       and relation_kind = 'filming_location';

    if v_link_id is null then
      insert into work_place_links (work_id, place_id, relation_kind, confidence)
      values (v_work.work_id, v_place_id, 'filming_location', v_work.confidence)
      returning id into v_link_id;
    end if;

    insert into place_evidence (subject_type, subject_id, method, source_url, source_ref, snippet, agrees)
    select 'link', v_link_id, 'text_mention',
           nullif(row_data->>'source_url', ''), nullif(row_data->>'source_kind', ''),
           left(nullif(row_data->>'snippet', ''), 500), true
      from jsonb_array_elements(p_rows) as row_data
     where (row_data->>'work_id')::uuid = v_work.work_id
       and not exists (
         select 1 from place_evidence e
          where e.subject_type = 'link' and e.subject_id = v_link_id
            and e.source_url is not distinct from nullif(row_data->>'source_url', '')
            and e.source_ref is not distinct from nullif(row_data->>'source_kind', '')
       );
  end loop;

  -- Last, so a crash anywhere above leaves the rows unpromoted and the next run redoes
  -- them rather than skipping a half-made fact.
  update location_submissions
     set place_id = v_place_id
   where id in (
     select (row_data->>'submission_id')::uuid from jsonb_array_elements(p_rows) as row_data
   );

  return v_place_id;
end;
$$;

comment on function promote_place is
  'Writes one promoted place, its evidence, its work links and each link''s evidence, and marks the submissions — in one transaction, because the link evidence trigger is checked at commit. The deciding lives in app/lib/promote-submission.mjs.';

revoke all on function promote_place(jsonb, uuid, jsonb) from public, anon, authenticated;
