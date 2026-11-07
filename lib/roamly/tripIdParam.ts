/*
 * tripIdParam — stop uuid-"null" reads at their source
 * (consolidation 2026-11-06, Block H).
 *
 * Production logs carried repeated reads against trip uuid
 * columns with the literal string "null" (and occasionally
 * "undefined"): a client that had no trip selected serialized
 * its empty state into the query string, and the API routes fed
 * the value straight into .eq("trip_id", …), where Postgres
 * rejected it as an invalid uuid (22P02) — noise in the logs and
 * a wasted round trip on hot polling routes (badge,
 * notifications).
 *
 * The rule: a trip id is either a UUID or it is ABSENT. Anything
 * else — "null", "undefined", "", a slug — means "no trip
 * selected", and the route takes its no-trip path instead of
 * querying with garbage.
 */

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return UUID_SHAPE.test(trimmed) ? trimmed : null;
}

/** True when the value claims to be a trip id but is not a UUID
 *  (the caller sent a serialized empty state, not a real id). */
export function isSerializedEmptyId(value: string | null | undefined): boolean {
  return value === "null" || value === "undefined";
}
