#!/usr/bin/env node
//
// Is SUPABASE_SERVICE_ROLE_KEY really the service_role key, and can it write?
//
//   node --env-file=.env.local scripts/check-service-key.mjs
//
// This exists as a file rather than a `node -e` string for two reasons, both
// learned the hard way. `node -e` runs as CommonJS unless Node decides the
// source looks like a module, so a top-level `await` is a coin flip that fails
// with "await is only valid in async functions". And a check embedded in a
// shell heredoc cannot be run on its own when it misbehaves, which is exactly
// when you need to run it on its own.
//
// It must test WRITING. An earlier version ran a select, which the anon key
// passes too — `works` is publicly readable — so it proved nothing and would
// have waved the wrong key through to a 6,029-row insert.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const fail = (message, ...rest) => {
  console.error(`  ${message}`);
  for (const line of rest) console.error(`  ${line}`);
  process.exit(1);
};

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set");
if (!key) fail("SUPABASE_SERVICE_ROLE_KEY is not set");

// Shape first: a truncated or line-wrapped paste is the common failure, and it
// is cheaper to name than to diagnose from whatever the server says about it.
if (/\s/.test(key)) {
  fail("the key contains a space or a newline — the paste was mangled",
       "Copy it again; it is one unbroken string with no line breaks.");
}
console.log(`  key: ${key.length} chars, starts ${key.slice(0, 6)}…`);

// A legacy key is a JWT and states its own role. Offline, exact, and it catches
// the mistake everyone actually makes: copying anon, which sits directly above
// service_role on that settings page and has the friendlier Copy button.
if (key.startsWith("eyJ")) {
  let claims;
  try {
    claims = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString());
  } catch {
    fail("not a readable JWT — the paste is truncated or damaged");
  }
  console.log(`  role claim: ${claims.role}`);
  if (claims.role !== "service_role") {
    fail(`this is the ${claims.role} key`,
         "You want the service_role row, below anon — click Reveal, then copy.");
  }
} else if (!key.startsWith("sb_secret_")) {
  fail("this does not look like a service_role key (expected eyJ… or sb_secret_…)");
}

const db = createClient(url, key, { auth: { persistSession: false } });

// Probe with a deliberately invalid row. NOTHING is ever written: a privileged
// key gets as far as the NOT NULL constraint (23502), while anon is stopped by
// row-level security before that (42501). That difference is the whole test.
const { error } = await db.from("works").insert({});

if (!error) fail("unexpected: an empty row was accepted — stopping rather than guessing");
if (error.code === "42501") {
  fail("row-level security refused the write — this key is not service_role",
       "A publishable/anon key cannot write. Use the secret service_role key.");
}
if (error.code?.startsWith("23")) {
  console.log("  ok — the key can write");
  process.exit(0);
}

// Anything else: show the whole error. A bare `error.message` was what made the
// previous failure unreadable — PostgREST leaves it empty for transport errors.
fail("unexpected error, so the key is not being trusted:",
     JSON.stringify({ code: error.code, message: error.message, details: error.details, hint: error.hint }));
