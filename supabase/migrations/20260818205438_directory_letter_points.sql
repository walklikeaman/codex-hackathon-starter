-- The index's headline needs both its numbers from one set of rows (#158).
--
-- It first read "6,392 films with 20,296 places between them" — a global work count beside
-- a count of only the places that happen to sit near a listed city, because the works came
-- from here and the places were summed from the city totals. Each number was right and the
-- sentence was not. `points` is returned here so both halves are measured over the same
-- rows.
--
-- Dropped and recreated rather than replaced: `create or replace function` cannot change a
-- function's return type, and this one gains a column.

drop function if exists catalogue_letter_totals();

create or replace function catalogue_letter_totals()
returns table (letter text, works integer, points integer)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    case when strpos('abcdefghijklmnopqrstuvwxyz', left(directory_sort_key(c.title_norm), 1)) > 0
         then left(directory_sort_key(c.title_norm), 1) else '#' end,
    count(*)::int,
    sum(c.place_count)::int
  from catalogue_index c
  group by 1
$$;

comment on function catalogue_letter_totals() is
  'Works and located places per directory letter. Lets the index state its own shape, and its headline, over one set of rows.';
