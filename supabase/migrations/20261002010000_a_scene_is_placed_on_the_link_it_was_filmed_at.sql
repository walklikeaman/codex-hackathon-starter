-- A story-trail scene is attached to the link that says the work was FILMED at the place,
-- with the plot quote that placed it as its evidence (#73).
--
-- The trail route used to INSERT a new link per scene, with relation_kind
-- 'narrative_location'. That failed twice over:
--
--   * work_place_links_require_evidence rejects any link without a place_evidence row,
--     and PostgREST cannot write both in one transaction — every scene link of the first
--     nine trails extracted on 2026-10-02 was refused;
--   * 'narrative_location' reads as "the story is SET here". Mentmore Towers is where
--     Batman Begins filmed Wayne Manor; "Batman Begins is set at Mentmore Towers" is false.
--
-- The scene happens in the story somewhere; it was filmed HERE. That link already exists,
-- already carries its evidence, and (work, place, relation) is unique, so the scene is set
-- ON it rather than beside it. What is new — that this scene comes at this point in the
-- story — gets its own evidence row, subject 'scene': the passage of the plot, verbatim,
-- and the article it was read from.

create or replace function place_scene_on_link(
  p_work_id uuid,
  p_place_id uuid,
  p_scene_id uuid,
  p_order integer,
  p_source_url text,
  p_quote text,
  p_model text default null
)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_link uuid;
begin
  -- The filming link if there is one, else whatever unscened link the work holds there.
  select l.id into v_link
  from work_place_links l
  where l.work_id = p_work_id and l.place_id = p_place_id and l.scene_id is null
  order by (l.relation_kind = 'filming_location') desc, l.created_at
  limit 1
  for update;

  if v_link is null then
    return null;
  end if;

  update work_place_links
     set scene_id = p_scene_id, narrative_order = p_order
   where id = v_link;

  insert into place_evidence (subject_type, subject_id, method, source_url, cited_quote, agrees, model, model_confidence)
  values ('scene', p_scene_id, 'text_mention', p_source_url, p_quote, true, p_model, 'medium');

  return v_link;
end;
$$;

revoke all on function place_scene_on_link(uuid, uuid, uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function place_scene_on_link(uuid, uuid, uuid, integer, text, text, text) to service_role;
