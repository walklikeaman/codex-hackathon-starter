create table if not exists public.user_media_libraries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  movies jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_media_libraries_movies_array check (jsonb_typeof(movies) = 'array'),
  constraint user_media_libraries_size check (jsonb_array_length(movies) <= 10000)
);

alter table public.user_media_libraries enable row level security;

create policy "Users can read their own media library"
on public.user_media_libraries for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own media library"
on public.user_media_libraries for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own media library"
on public.user_media_libraries for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own media library"
on public.user_media_libraries for delete
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.user_media_libraries is
  'Normalized personal media libraries imported in the browser and owned by one Supabase Auth user.';
