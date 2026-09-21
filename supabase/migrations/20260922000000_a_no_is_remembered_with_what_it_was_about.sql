-- A "no" from the card's matcher, remembered with exactly what it was a "no" to.
--
-- A matched frame is a claim about the world and lives on `place_frames`. A miss is not:
-- it says only that this matcher, shown these frames and this reference photo, found
-- none it would stand behind. So it is keyed by the Wikidata pair the card asks about —
-- it needs no row of ours, and covers the two thirds of pairs that have none — and it
-- carries a fingerprint of its inputs instead of an expiry date. TMDB adding backdrops,
-- a place gaining a photo, or the matcher changing all produce a different fingerprint
-- or version, and the question is asked again. Nothing else makes it stale.
--
-- Measured before: 7 of 10 first asks on production ended "no_high_confidence_match",
-- each after two vision calls and 10-12 s, and each was asked again whenever the CDN
-- entry (one day) expired.

create table if not exists scene_match_verdicts (
  work_qid text not null check (work_qid ~ '^Q[1-9][0-9]*$'),
  place_qid text not null check (place_qid ~ '^Q[1-9][0-9]*$'),
  matcher_version text not null,
  inputs_hash text not null check (inputs_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('no_high_confidence_match')),
  match_confidence text,
  candidates integer not null check (candidates >= 0),
  judged_at timestamptz not null default now(),
  primary key (work_qid, place_qid)
);

-- Server-side bookkeeping, not data anybody browses: RLS on and no policies, so only the
-- service role reads or writes it.
alter table scene_match_verdicts enable row level security;
