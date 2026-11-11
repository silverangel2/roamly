import { secretMatchesAny, secretValuesEqual } from "@/lib/roamly/secretCompare";

type HeaderReader = {
  get(name: string): string | null;
};

export function isCronRequestAuthorized(headers: HeaderReader, expectedSecret: string) {
  const expected = expectedSecret.trim();
  if (!expected) return false;

  const authorization = headers.get("authorization")?.trim() || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const bearerSecret = bearerMatch?.[1]?.trim() || "";
  const headerSecret = headers.get("x-cron-secret")?.trim() || "";

  return Boolean(
    (bearerSecret && secretValuesEqual(bearerSecret, expected)) ||
      (headerSecret && secretValuesEqual(headerSecret, expected))
  );
}

/*
 * List form for the two cron doors that accept a current secret plus
 * its rotation predecessor (Stage 5, 2026-11-11): the caller extracts
 * its Bearer token exactly as before — same carrier, same fail-closed
 * posture — and only the comparison changes, from plain Array.includes
 * equality to the shared constant-time compare.
 */
export function cronTokenMatchesAnySecret(token: string, expectedSecrets: readonly string[]) {
  return secretMatchesAny(token, expectedSecrets);
}
