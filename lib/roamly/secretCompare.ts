import { timingSafeEqual } from "node:crypto";

/*
 * Shared constant-time secret comparison (Stage 5, 2026-11-11).
 *
 * Before this module, each door kept its own compare: the cron helper
 * (lib/roamly/cronAuth.ts), the Sophie door and the admin door had
 * hand-rolled timing-safe compares (all correct), while two cron routes
 * and the Gmail webhook compared shared secrets with plain equality
 * (Array.includes / ===), which leaks match progress through response
 * timing. Every direct secret compare now routes through here so the
 * method cannot drift again; the wiring suite pins the call sites.
 *
 * Semantics, deliberately identical to the compare the cron helper has
 * always used: an empty expected secret NEVER matches (fail closed when
 * a door is unconfigured), an empty provided value never matches, and
 * the byte-length pre-check runs before timingSafeEqual (which throws
 * on length mismatch). The length pre-check reveals only the secret's
 * length through timing — the accepted, standard trade-off, already
 * documented at the Sophie door (lib/sophieCommand.ts keyMatches).
 */
export function secretValuesEqual(provided: string, expected: string): boolean {
  const candidate = String(expected || "");
  if (!candidate) return false;
  const given = Buffer.from(String(provided || ""));
  const wanted = Buffer.from(candidate);
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}

/*
 * Any-of match for doors that accept a small list of equivalent secrets
 * (the two cron doors each accept a current secret plus its rotation
 * predecessor). Every non-empty candidate is compared even after a
 * match, so the loop count does not reveal which list entry matched.
 * An empty or all-empty list never matches (fail closed).
 */
export function secretMatchesAny(provided: string, expectedSecrets: readonly string[]): boolean {
  const given = String(provided || "");
  if (!given) return false;
  let matched = false;
  for (const expected of expectedSecrets) {
    if (secretValuesEqual(given, expected)) matched = true;
  }
  return matched;
}
