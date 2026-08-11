-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.
--
-- Read 20260808010100_a_fact_has_its_own_identity.sql before trusting the reasoning
-- in the comment below: the partial index it creates cannot be inferred by an
-- `ON CONFLICT (work_id, place_id, relation_kind)` clause, which is exactly what
-- /api/resolve sends, so this migration silently killed the graph write path.

-- A story may return to a place, and that is the point of a story trail (#71).
--
-- The old constraint was unique on (work_id, place_id, relation_kind), which is right
-- for a work's own places — one edge per place — but forbids Skyfall from visiting
-- London in scenes 2, 7 and 9. A plot that doubles back is exactly what the dashed
-- numbered line exists to show.
--
-- Split in two rather than adding scene_id to one index: with NULLs treated as
-- distinct, a single combined index would silently stop enforcing work-level
-- uniqueness, which is the guarantee that keeps the map from growing duplicate pins.

alter table work_place_links
  drop constraint if exists work_place_links_work_id_place_id_relation_kind_key;

-- A work's own places: still exactly one edge each.
create unique index if not exists work_place_links_work_place_idx
  on work_place_links (work_id, place_id, relation_kind)
  where scene_id is null;

-- Scene edges: one per scene, so the same place may appear at several points in the
-- story without colliding.
create unique index if not exists work_place_links_scene_idx
  on work_place_links (scene_id)
  where scene_id is not null;
