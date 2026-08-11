-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- A trail stop must be somewhere you can stand (#71 follow-up).
--
-- The trail was drawing a numbered pin for "Istanbul" exactly like it draws one for
-- the National Gallery. That pin is a city centroid: it says "walk to this point"
-- about a place you cannot walk to. We already distinguish City / Street / Building
-- everywhere else — the trail simply had no access to it, because the RPC did not
-- return precision.
--
-- Dropped first: changing a function's return type is not something `create or
-- replace` will do, and adding columns to the OUT list is a return-type change.

drop function if exists work_scenes(uuid, int);

create function work_scenes(p_work_id uuid, p_progress int default 0)
returns table (
  scene_id uuid,
  sequence_index integer,
  act_or_chapter text,
  spoiler_tier smallint,
  revealed boolean,
  plot_beat text,
  safe_teaser text,
  place_id uuid,
  place_name text,
  lat double precision,
  lng double precision,
  -- New: how precisely the place is known, so the client can tell a spot you can
  -- stand on from an area you can only be inside.
  geocode_precision text,
  osm_building_id text
)
language sql stable
as $$
  select
    s.id,
    s.sequence_index,
    case when revealed.ok then s.act_or_chapter end,
    s.spoiler_tier,
    revealed.ok,
    case when revealed.ok then s.plot_beat end,
    s.safe_teaser,
    case when revealed.ok then l.place_id end,
    case when revealed.ok then p.name end,
    case when revealed.ok then p.lat end,
    case when revealed.ok then p.lng end,
    case when revealed.ok then p.geocode_precision end,
    case when revealed.ok then p.osm_building_id end
  from scenes s
  cross join lateral (
    select coalesce(s.spoiler_tier, 0) <= greatest(coalesce(p_progress, 0), 0) as ok
  ) revealed
  left join work_place_links l on l.scene_id = s.id
  left join places p on p.id = l.place_id
  where s.work_id = p_work_id
  order by s.sequence_index nulls last, s.id
$$;
