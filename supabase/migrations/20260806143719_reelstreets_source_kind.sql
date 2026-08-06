-- A fourth kind of submission: reelstreets.com.
--
-- Alone in its own migration for the same reason as moviemaps_source_kind:
-- Postgres refuses to USE a new enum value in the transaction that created it,
-- so the evidence check that names it has to be a separate transaction.
alter type submission_source_kind add value if not exists 'reelstreets';
