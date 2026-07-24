-- `create or replace function` only replaces an EXACT signature match. Adding
-- p_kinds / p_limit / p_max_clusters in 20260724010000_map_points_fixes.sql therefore
-- created OVERLOADS and left the original definitions live and callable — still
-- filtering the bbox in geography space (a world-spanning envelope is degenerate, so
-- a zoomed-out map returned nothing), still skipping the evidence requirement, and
-- still inverting an antimeridian-crossing viewport into its complement.
--
-- Two live functions with the same name also make the call ambiguous for PostgREST,
-- which refuses to choose and fails the request.
--
-- Lesson for future migrations: changing a function's parameter list is a DROP, not a
-- replace. Verify with pg_get_function_identity_arguments after applying.

drop function if exists public.fictional_places(uuid);
drop function if exists public.map_clusters_in_view(
  double precision, double precision, double precision, double precision, integer, uuid, text[]
);
