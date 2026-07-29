// Who may run the write routes (#120).
//
// Six routes write to the database and spend real money: the two vision enrichers, the
// trail extractor, the poster and ratings enrichers, and the footprint snap. All of
// them hold the service-role key, so RLS does not constrain them. Any of them, reached
// by anyone who knows the URL, is a bill and a mutation.
//
// Two properties matter more than the mechanism:
//
//   * **Fail closed.** A missing token means the route is SHUT, not open. The opposite
//     default — "no secret configured, so let everyone in" — is how this kind of guard
//     silently stops guarding after an environment is rebuilt.
//   * **Constant time.** A plain `===` on a secret leaks its length and its matching
//     prefix through timing. The comparison is cheap; doing it wrong is free to exploit.
//
// `/api/film-image` already uses an HMAC token and a rate limit and is left alone —
// this is the same idea for routes that had nothing.

import { timingSafeEqual } from "node:crypto";

export const ENRICH_TOKEN_HEADER = "x-enrich-token";

// Compare without revealing where two strings diverge. `timingSafeEqual` throws on a
// length mismatch, which would itself be a timing signal, so both sides are hashed to
// a fixed width first — done by padding here rather than pulling in a digest, since the
// values are short and the comparison only needs to be length-independent.
export function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (expected.length === 0) return false;

  const width = Math.max(provided.length, expected.length, 32);
  const a = Buffer.alloc(width);
  const b = Buffer.alloc(width);
  a.write(provided);
  b.write(expected);
  // Length is compared too, but as data rather than as an early return.
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

// The token a request presented. Accepts the dedicated header or a bearer, because a
// cron scheduler may only be able to send one of them.
export function presentedToken(request) {
  const headers = request?.headers;
  const direct = headers?.get?.(ENRICH_TOKEN_HEADER);
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const authorization = headers?.get?.("authorization");
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }
  return null;
}

// null = allowed through. Otherwise a Response to return immediately.
//
// The two refusals are deliberately different: 503 says "this route is not configured
// to run", 401 says "you are not who may run it". Collapsing them would hide a broken
// deployment behind what looks like an ordinary rejection.
export function enrichGuard(request, env = process.env) {
  const expected = env?.ENRICH_TOKEN;
  if (typeof expected !== "string" || expected.trim().length === 0) {
    return Response.json(
      { error: "This route is not configured to run." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (!secretsMatch(presentedToken(request) ?? "", expected.trim())) {
    // No hint about what was wrong — a guard that explains itself is a guard that
    // helps someone tune their guesses.
    return Response.json(
      { error: "Not authorised." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return null;
}
