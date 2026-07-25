-- Spoiler safety, enforced in the DATABASE rather than in the UI.
--
-- Blurring a later scene in CSS is not protection: anyone can open DevTools and read
-- the payload. So the query itself withholds everything about a scene the reader has
-- not reached — including its COORDINATES, because where a scene happens is often the
-- spoiler ("the final chapter is set at X"). A withheld scene comes back as a
-- numbered placeholder and nothing else.

-- The spoiler-free line that may always be shown, as opposed to plot_beat which may
-- give away the story. Written per scene when trails are extracted (#71).
alter table scenes add column if not exists safe_teaser text;

create index if not exists scenes_work_tier_idx on scenes (work_id, spoiler_tier, sequence_index);

-- Scenes of a work, revealed only up to the reader's progress.
--   p_progress = the chapter/episode they have reached. 0 (the default) is the
--   spoiler-safe floor: only tier-0 scenes, which carry no plot information at all.
create or replace function work_scenes(p_work_id uuid, p_progress int default 0)
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
  lng double precision
)
language sql stable
as $$
  select
    s.id,
    s.sequence_index,
    -- Even the chapter label can spoil ("Chapter 12: The Death of ..."), so it is
    -- withheld too; the placeholder keeps only its position in the sequence.
    case when revealed.ok then s.act_or_chapter end,
    s.spoiler_tier,
    revealed.ok,
    case when revealed.ok then s.plot_beat end,
    -- The teaser is spoiler-free by definition, so it is always safe to show.
    s.safe_teaser,
    case when revealed.ok then l.place_id end,
    case when revealed.ok then p.name end,
    case when revealed.ok then p.lat end,
    case when revealed.ok then p.lng end
  from scenes s
  cross join lateral (
    select coalesce(s.spoiler_tier, 0) <= greatest(coalesce(p_progress, 0), 0) as ok
  ) revealed
  left join work_place_links l on l.scene_id = s.id
  left join places p on p.id = l.place_id
  where s.work_id = p_work_id
  order by s.sequence_index nulls last, s.id
$$;
