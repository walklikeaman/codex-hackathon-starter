-- A promoted fact carries its source's own sentence (#queue-review, follow-up).
--
-- `work_place_links.statement` is what the card prints verbatim, and nothing wrote it: all
-- 4,688 links were empty on 22.09, so every card fell back to a sentence built from the
-- relation kind — and every promoted row is a `filming_location`. On production the cards
-- read "Crime and Punishment was filmed at 14 ulitsa Kaznacheiskaia" and "Finnegans Wake was
-- filmed at 6 Alexandra Terrace", where the plaques say the novels were WRITTEN there.
--
-- The deciding stays in app/lib/promote-submission.mjs (`quoteFrom`): only sources whose
-- words we may print — a plaque's inscription, a Wikipedia sentence — and never a sentence
-- shortened to fit. This function only writes the `quote` it is handed, and only onto a link
-- that has no statement yet. Everything else is the function as it stood, unchanged.

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

    -- The source's own sentence, where the caller found one we may print (quoteFrom).
    -- Only onto a link that has none: a statement already there was put there by somebody
    -- on purpose, and a later promotion is not a reason to change what a card quotes.
    update work_place_links
       set statement = (
         select row_data->>'quote'
           from jsonb_array_elements(p_rows) as row_data
          where (row_data->>'work_id')::uuid = v_work.work_id
            and nullif(row_data->>'quote', '') is not null
          limit 1
       )
     where id = v_link_id
       and statement is null
       and exists (
         select 1 from jsonb_array_elements(p_rows) as row_data
          where (row_data->>'work_id')::uuid = v_work.work_id
            and nullif(row_data->>'quote', '') is not null
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
