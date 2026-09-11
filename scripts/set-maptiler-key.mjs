// Record the MapTiler key for local development (#202).
//
//   node scripts/set-maptiler-key.mjs <key>
//
// Writes `NEXT_PUBLIC_MAPTILER_KEY` into `.env.local`, which is gitignored. Production does
// NOT read this file — the deploy workflow runs `vercel pull --environment=production`, so
// the key has to be set on the Vercel project as well. The script says so when it finishes,
// because a key that works locally and not in production is the confusing half of this.
//
// The key is public by design: it ships in the browser bundle and MapTiler restricts it by
// domain in their dashboard. This script still writes it to a gitignored file rather than a
// committed one — not because it is a secret, but because a key in the repository is a key
// nobody can rotate without a commit.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { isUsableKey, styleUrl, THEMES } from "../app/lib/map-styles.mjs";

const VARIABLE = "NEXT_PUBLIC_MAPTILER_KEY";
const ENV_FILE = path.join(process.cwd(), ".env.local");

const key = process.argv[2]?.trim();

if (!key) {
  console.error(`Usage: node scripts/set-maptiler-key.mjs <key>

Get one free at https://cloud.maptiler.com/account/keys/`);
  process.exit(1);
}

// The same check the app uses, so a key this script accepts is a key the map will accept.
// The common mistake is pasting the whole dashboard URL instead of the key out of it, which
// produces a request that fails at MapTiler with no useful message.
if (!isUsableKey(key)) {
  console.error(`That does not look like a MapTiler key: ${JSON.stringify(key)}

A key is letters, digits, underscores and hyphens — no "?", no spaces, no URL around it.
If you copied a whole style URL, take the part after "key=".`);
  process.exit(1);
}

const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const line = `${VARIABLE}=${key}`;

// Replace the variable in place if it is already there, so running this twice does not leave
// two definitions — the last one would win silently and the first would look authoritative.
const pattern = new RegExp(`^${VARIABLE}=.*$`, "m");
let next;
if (pattern.test(existing)) {
  next = existing.replace(pattern, line);
} else {
  next = existing.length && !existing.endsWith("\n") ? `${existing}\n${line}\n` : `${existing}${line}\n`;
}

writeFileSync(ENV_FILE, next, "utf8");

const shown = `${key.slice(0, 4)}…${key.slice(-2)}`;
console.log(`Wrote ${VARIABLE}=${shown} to .env.local`);
console.log(`The map will now draw: ${styleUrl(THEMES.dark, key).split("?")[0]}`);
console.log(`
Two more things, and neither happens by itself:

  1. Restart the dev server. Next.js reads .env.local at startup.
  2. Set the same variable on the Vercel project, or production keeps drawing OpenFreeMap:
     Vercel → the project → Settings → Environment Variables → ${VARIABLE}
     (Production, Preview and Development), then redeploy.`);
