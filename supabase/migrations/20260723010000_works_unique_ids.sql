-- Unique external-id indexes on works so imports can upsert-or-get by id.
-- Plain (non-partial) unique indexes: Postgres treats NULLs as distinct, so many
-- rows without a given id coexist, while non-null ids stay unique. Non-partial so
-- they can be the ON CONFLICT target in the import routes (partial indexes with a
-- WHERE predicate can't be targeted by `on conflict (col)` without the predicate).

drop index if exists works_tmdb_uidx;
drop index if exists works_imdb_uidx;
drop index if exists works_isbn_uidx;
drop index if exists works_mbid_uidx;

create unique index if not exists works_tmdb_uidx on works (tmdb_id);
create unique index if not exists works_imdb_uidx on works (imdb_id);
create unique index if not exists works_isbn_uidx on works (isbn);
create unique index if not exists works_mbid_uidx on works (mbid);
