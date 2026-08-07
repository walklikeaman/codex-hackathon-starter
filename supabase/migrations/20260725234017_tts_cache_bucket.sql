-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- Cache for generated narration audio, keyed by a hash of (text, voice, model).
--
-- Public-read: a guide clip is not secret, and a public object is served straight from
-- the CDN — which is the point, since the whole feature exists to make a replay
-- instant and free. Writes stay service-role only, like the rest of the graph.
--
-- 10 MB cap: a narration is capped at 600 characters upstream, so anything larger is
-- a bug or an abuse rather than a guide clip.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tts-cache', 'tts-cache', true, 10485760, array['audio/mpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tts cache is public read" on storage.objects;
create policy "tts cache is public read" on storage.objects
  for select using (bucket_id = 'tts-cache');

select id, public, file_size_limit from storage.buckets where id = 'tts-cache';
