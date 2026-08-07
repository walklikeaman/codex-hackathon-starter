-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

drop function if exists public.map_works(text[], int);

create function map_works(p_kinds text[] default null, p_limit int default 200)
returns table (
  work_id uuid, title text, kind text, place_count integer,
  poster_path text, imdb_id text, rt_path text, ratings jsonb
)
language sql stable as $$
  select w.id, w.title, w.kind, count(distinct l.place_id)::int, w.poster_path,
         w.imdb_id, w.rt_path,
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'source', r.source, 'score', r.score,
                     'display', r.display, 'url', r.source_url)
                   order by case r.source
                     when 'imdb' then 1 when 'rotten_tomatoes' then 2
                     when 'metacritic' then 3 else 4 end)
            from work_ratings r where r.work_id = w.id),
           '[]'::jsonb)
  from works w
  join work_place_links l on l.work_id = w.id
  join places p on p.id = l.place_id
  where place_is_mappable(p.lat, p.place_class, p.confidence, p.id)
    and (p_kinds is null or w.kind = any(p_kinds))
  group by w.id, w.title, w.kind, w.poster_path, w.imdb_id, w.rt_path
  order by count(distinct l.place_id) desc, w.title
  limit p_limit
$$;

select count(*) as map_works_versions from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname='map_works';
