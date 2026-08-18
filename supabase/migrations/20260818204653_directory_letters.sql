-- The A-Z half of the directory (#158): 6,392 works, one page of URLs per letter.
--
-- Filed by the FIRST CHARACTER of `title_norm`, not of the display title, so that one
-- column decides both the bucket and the order and the client's letterBucket() reads the
-- same column. (Measured the moment this answered: it put 1,427 of 6,392 works — 22% of
-- the catalogue — under T, because half our sources write "The Dark Knight" and half write
-- "Bulls, The". The next migration is the fix.)
--
-- The letter test is `strpos` over an explicit alphabet rather than `~ '^[a-z]'` or a
-- BETWEEN. A character range in a regular expression or a comparison is resolved against
-- the database collation, and this database is not in the C locale: under en_US.UTF-8
-- 'Á' sorts between 'a' and 'b', so a range test would file an accented title under a
-- letter and the enumerated test files it under '#', which is where the client expects it.

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
            then left(c.title_norm, 1) = lower(p_letter)
          -- Anything not opening with a Latin letter: "1917", "28 Weeks Later", and any
          -- title in another alphabet. A real bucket with real works in it.
          else strpos('abcdefghijklmnopqrstuvwxyz', left(c.title_norm, 1)) = 0
        end
  order by c.title_norm asc, c.year asc nulls last
  limit greatest(1, least(p_limit, 500))
  offset greatest(0, p_offset)
$$;

comment on function catalogue_letter(text, integer, integer) is
  'One page of the A-Z directory.';

-- How many works sit under each letter, so the index can show the shape of the catalogue
-- instead of 27 identical links. One pass over 6,392 rows.
create or replace function catalogue_letter_totals()
returns table (letter text, works integer)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    case when strpos('abcdefghijklmnopqrstuvwxyz', left(c.title_norm, 1)) > 0
         then left(c.title_norm, 1) else '#' end,
    count(*)::int
  from catalogue_index c
  group by 1
$$;

comment on function catalogue_letter_totals() is
  'Works per directory letter.';
