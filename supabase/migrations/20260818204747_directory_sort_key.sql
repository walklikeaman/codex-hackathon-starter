-- The article rule (#158), and the measurement that demanded it.
--
-- The migration before this one filed the A-Z on the raw `title_norm`. That put **1,427 of
-- 6,392 works — 22% of the catalogue — under T**, because our sources disagree about
-- articles: movie-locations ships "Caper of the Golden Bulls, The" and TMDB ships "The Dark
-- Knight", so no single convention puts both under the same letter.
--
-- Stripping only a LEADING article fixes exactly the titles that carry one and leaves the
-- comma-inverted ones alone, because theirs already sits at the end. One rule, both
-- conventions: T fell to 330 and S became the largest letter at 640. The same rule lives in
-- the client's letterBucket(), so a work is never filed under a letter its own page does
-- not list, and the two must not drift.

create or replace function directory_sort_key(p_title_norm text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select case
    when p_title_norm like 'the %' then substr(p_title_norm, 5)
    when p_title_norm like 'an %'  then substr(p_title_norm, 4)
    when p_title_norm like 'a %'   then substr(p_title_norm, 3)
    else p_title_norm
  end
$$;

comment on function directory_sort_key(text) is
  'A title stripped of its leading article, so "The Dark Knight" files under D and "Caper of the Golden Bulls, The" still files under C.';

create or replace function catalogue_letter(
  p_letter text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  work_id uuid, title text, title_norm text, year integer,
  kind text, place_count integer, total_works integer
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    c.id, c.title, c.title_norm, c.year, c.kind::text, c.place_count,
    count(*) over ()::int
  from catalogue_index c
  where case
          when p_letter is not null and length(p_letter) = 1
               and strpos('abcdefghijklmnopqrstuvwxyz', lower(p_letter)) > 0
            then left(directory_sort_key(c.title_norm), 1) = lower(p_letter)
          else strpos('abcdefghijklmnopqrstuvwxyz', left(directory_sort_key(c.title_norm), 1)) = 0
        end
  order by directory_sort_key(c.title_norm) asc, c.year asc nulls last
  limit greatest(1, least(p_limit, 500))
  offset greatest(0, p_offset)
$$;

comment on function catalogue_letter(text, integer, integer) is
  'One page of the A-Z directory. Filed by the first character of title_norm with its leading article removed, which is the one key both the database order and the client bucket agree on.';

create or replace function catalogue_letter_totals()
returns table (letter text, works integer)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    case when strpos('abcdefghijklmnopqrstuvwxyz', left(directory_sort_key(c.title_norm), 1)) > 0
         then left(directory_sort_key(c.title_norm), 1) else '#' end,
    count(*)::int
  from catalogue_index c
  group by 1
$$;

comment on function catalogue_letter_totals() is
  'Works per directory letter. Lets the index state its own shape rather than promising 27 equal pages.';
