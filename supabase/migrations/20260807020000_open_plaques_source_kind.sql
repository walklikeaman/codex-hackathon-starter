-- A fourth kind of submission: commemorative plaques (#125).
--
-- The enum value and NOTHING else, for the reason 20260805003943 already recorded:
-- Postgres refuses to use a new enum value in the same transaction that created it —
--
--   ERROR: unsafe use of new value "open_plaques" of enum type submission_source_kind
--
-- so the CHECK that names it lives in the next migration, which is a separate
-- transaction. A single file would pass on a database where the value already exists and
-- fail on a clean one, which is the worst way for a migration to be wrong.

alter type submission_source_kind add value if not exists 'open_plaques';
