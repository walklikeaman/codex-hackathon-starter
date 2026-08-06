-- What the Supabase linter found, and which of it is actually ours.
--
-- Two errors and twenty warnings, and they are not equally real. Sorted by whether a
-- stranger with the anon key can do something with them:
--
--   * the view ran with its OWNER's rights, which is a real hole and is fixed here;
--   * ten of our functions had no fixed search_path, which is the classic way a
--     function can be made to resolve a different table than the one it names;
--   * anon and authenticated could WRITE to PostGIS's spatial_ref_sys — full
--     arwdDxtm on a reference table nobody but PostGIS should touch;
--   * three extensions live in `public`, which is untidy and is not an exposure.
--
-- One finding is left open on purpose, at the bottom, because we cannot fix it and
-- pretending otherwise would be worse than the warning.

-- 1. The view ran with the rights of whoever created it -------------------------------
--
-- `links_without_evidence` lists the debt from the provenance rule: links with no
-- evidence row. A view without `security_invoker` executes as its owner (postgres),
-- so every row-level rule of the caller is bypassed — which is exactly what the
-- ERROR says. Nothing about this view needs owner rights: it is read by the service
-- role, which sees the tables anyway.
alter view public.links_without_evidence set (security_invoker = true);

comment on view public.links_without_evidence is
  'Links with no evidence row — the debt the provenance rule cannot retroactively fix. '
  'security_invoker: the caller''s own permissions decide what it returns.';

-- 2. A function with no search_path resolves whatever the caller points it at ---------
--
-- All ten are SECURITY INVOKER, so this is not a privilege-escalation hole today —
-- but `map_points_in_view` and friends are called with the ANON key from the browser,
-- and a function that names `places` without a fixed search_path names whatever
-- `places` the session's search_path finds first.
--
-- `extensions` is in the list even though PostGIS, pg_trgm and vector currently live
-- in `public`: these functions use ST_* and the trigram operators, and the day those
-- extensions are moved is the day every one of them would break without it.
alter function public.map_cluster_cell(integer)
  set search_path = public, extensions, pg_catalog;
alter function public.map_points_in_view(double precision, double precision, double precision, double precision, integer, uuid, text[], integer, integer)
  set search_path = public, extensions, pg_catalog;
alter function public.map_clusters_in_view(double precision, double precision, double precision, double precision, integer, uuid, text[], integer)
  set search_path = public, extensions, pg_catalog;
alter function public.fictional_places(uuid, text[], integer)
  set search_path = public, extensions, pg_catalog;
alter function public.remote_points(double precision, double precision, integer, uuid, text[])
  set search_path = public, extensions, pg_catalog;
alter function public.map_works(text[], integer)
  set search_path = public, extensions, pg_catalog;
alter function public.search_works(text, integer)
  set search_path = public, extensions, pg_catalog;
alter function public.place_is_mappable(double precision, place_class, numeric, uuid)
  set search_path = public, extensions, pg_catalog;
alter function public.work_scenes(uuid, integer)
  set search_path = public, extensions, pg_catalog;
alter function public.require_link_evidence()
  set search_path = public, extensions, pg_catalog;

-- 3 & 4. PostGIS's own objects — ATTEMPTED AND REFUSED --------------------------------
--
-- These two belong in this file as a record, not as SQL, because the SQL does nothing:
--
--   revoke execute on function public.st_estimatedextent(text, text) from anon, …
--   revoke insert, update, delete on table public.spatial_ref_sys from anon, …
--   alter table public.spatial_ref_sys enable row level security;
--
-- Every one of those runs without error and changes nothing. The grants were made BY
-- `supabase_admin` and this database's `postgres` role cannot revoke another grantor's
-- grants, cannot enable RLS on a table it does not own, and cannot `set role
-- supabase_admin`. All three were tried against the live database and verified after
-- the fact: `anon` still has arwdDxtm on `spatial_ref_sys`, and still has EXECUTE on
-- `st_estimatedextent`.
--
-- Shipping the statements anyway would leave a migration that reads like a fix and is
-- not one, so they are written here as prose instead. See the note at the bottom.

-- 5. Two policies where one does the work ----------------------------------------------
--
-- `own library write` is FOR ALL, so it already covers SELECT; the separate select
-- policy only made Postgres evaluate two permissive policies per row. And auth.uid()
-- written bare is re-evaluated FOR EVERY ROW — wrapped in a subselect it is evaluated
-- once. Same rule, same rows, less work.
drop policy if exists "own library select" on public.user_library_items;
drop policy if exists "own library write" on public.user_library_items;

create policy "own library" on public.user_library_items
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 6. Foreign keys nobody indexed --------------------------------------------------------
--
-- Every one of these is the child side of a cascade: deleting a place or a work makes
-- Postgres scan the whole child table to find the rows pointing at it.
create index if not exists location_submissions_place_idx
  on public.location_submissions (place_id);
create index if not exists user_library_items_work_idx
  on public.user_library_items (work_id);
create index if not exists work_creators_creator_idx
  on public.work_creators (creator_id);

-- LEFT OPEN, and why --------------------------------------------------------------------
--
-- One ERROR and nine WARNINGS survive this migration, all of them about objects owned by
-- `supabase_admin`. They need a role this project does not have:
--
--   * rls_disabled_in_public on `spatial_ref_sys` (ERROR) — and note what it means here:
--     `anon` really can DELETE from the SRID registry through PostgREST. It is PostGIS
--     reference data rather than ours, but it is writable by anybody with the public
--     key, and we cannot close it from this role.
--   * anon/authenticated EXECUTE on `st_estimatedextent` (6 warnings).
--   * postgis, pg_trgm and vector installed in `public` (3 warnings).
--
-- The one action that would clear all ten is getting the extensions out of `public`, and
-- it is not available either: PostGIS does not support `ALTER EXTENSION … SET SCHEMA`,
-- and dropping and recreating would take `places.centroid` (geography) and
-- `places.frame_embedding` (vector) with it — the map's coordinates and the frame
-- embeddings. That is a real database for a linter score.
--
-- What is left is asking Supabase support to revoke the PostGIS grants, or creating the
-- next project with the extensions in `extensions` from the start. Until then this is a
-- warning we live with rather than a fix we fake.
