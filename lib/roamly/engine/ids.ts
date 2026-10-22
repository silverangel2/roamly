import { createHash } from "crypto";

/*
 * Stable IDs — the identity scheme for the production wiring
 * (DESIGN-PRODUCTION.md §1.3, Phase 1).
 *
 * Two families of identity, never mixed:
 *
 * 1. SOURCE KEYS — `<source>:<sourceId>`, the durable cross-system key
 *    for anything that exists outside Roamly: a candidate is its
 *    (source, source ID) pair, a booking fact is its Gmail message,
 *    a place enrichment is its Google Place ID. Source IDs are the
 *    provider's own identifiers, verbatim — never a name or slug.
 *      osm:node/283264348        (the shadow OSM key is the source ID)
 *      google:ChIJ...            (Google Place ID — external id only)
 *      gmail:<message-id>        (RFC message id, angle brackets kept)
 *
 * 2. CONTENT IDS — `<prefix>-<16 hex>` where the hex is the first 16
 *    characters of the SHA-256 of the content key: the identifying
 *    fields joined with "|". Deterministic: the same content always
 *    yields the same ID, on any machine, with no coordination. This is
 *    exactly the shadow reconciliation scheme (part2
 *    email-reconciliation.mjs: `recon-${sha(parts.join("|")).slice(0,16)}`
 *    over SHA-256 hex), generalized to every entity that needs a
 *    content-derived identity. 16 hex chars = 64 bits: collision-safe
 *    at Roamly's scale, short enough to read in a log.
 *
 * Rules:
 *   - Content-key parts are the entity's IDENTIFYING fields only —
 *     never a display name where a reference exists, never a timestamp
 *     of when we happened to process it (processing time is not
 *     identity; the same signal re-synced must produce the same ID —
 *     that is what makes sync idempotent).
 *   - Parts must be strings without "|" (the join separator). Builders
 *     throw on a "|" part rather than minting an ambiguous key.
 *   - Row IDs in the database (trips, proposals, ledger rows) remain
 *     database UUIDs; content IDs identify the CONTENT those rows
 *     carry and serve as idempotency keys beside them.
 */

export type IdSource = "osm" | "google" | "gmail" | "library" | "manual";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const PREFIX_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Deterministic content ID: `<prefix>-<first 16 hex of sha256>`.
 * `parts` are joined with "|" after String() coercion of numbers;
 * null/undefined parts become the empty string (the shadow scheme's
 * behavior for absent optional fields).
 */
export function contentId(prefix: string, parts: readonly (string | number | null | undefined)[]): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new RangeError(`invalid content-id prefix: ${prefix}`);
  }
  const normalized = parts.map((p) => (p === null || p === undefined ? "" : String(p)));
  for (const part of normalized) {
    if (part.includes("|")) {
      throw new RangeError(`content-id part must not contain "|": ${part}`);
    }
  }
  return `${prefix}-${sha256Hex(normalized.join("|")).slice(0, 16)}`;
}

const CONTENT_ID_PATTERN = /^[a-z][a-z0-9-]*-[0-9a-f]{16}$/;

export function isContentId(value: unknown): value is string {
  return typeof value === "string" && CONTENT_ID_PATTERN.test(value);
}

/** `<source>:<sourceId>` — the durable key for an externally-owned thing. */
export function sourceKey(source: IdSource, sourceId: string): string {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    throw new RangeError("sourceId must be a non-empty string");
  }
  return `${source}:${sourceId}`;
}

export function isSourceKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const idx = value.indexOf(":");
  if (idx <= 0 || idx === value.length - 1) return false;
  const source = value.slice(0, idx);
  return (
    source === "osm" ||
    source === "google" ||
    source === "gmail" ||
    source === "library" ||
    source === "manual"
  );
}

export function parseSourceKey(value: string): { source: IdSource; sourceId: string } {
  if (!isSourceKey(value)) throw new RangeError(`not a source key: ${value}`);
  const idx = value.indexOf(":");
  return {
    source: value.slice(0, idx) as IdSource,
    sourceId: value.slice(idx + 1)
  };
}

/*
 * Entity builders — the field lists ARE the scheme; changing a field
 * list changes every ID it produces, so treat these as versioned
 * contracts (bump the prefix, e.g. recon2-, if a list must change).
 */

/**
 * Booking-signal ID — byte-identical to the shadow scheme (part2
 * email-reconciliation.mjs): fields are the booking's message id,
 * reference, status, and stated start/end date+time.
 */
export function bookingSignalId(fields: {
  messageId: string | null | undefined;
  reference: string | null | undefined;
  status: string | null | undefined;
  start?: { date?: string | null; time?: string | null } | null;
  end?: { date?: string | null; time?: string | null } | null;
}): string {
  return contentId("recon", [
    fields.messageId,
    fields.reference,
    fields.status,
    fields.start?.date,
    fields.start?.time,
    fields.end?.date,
    fields.end?.time
  ]);
}

/** Itinerary item ID: content of the placement, not the place's name. */
export function itineraryItemId(fields: {
  tripId: string;
  dayNumber: number;
  candidateSourceKey: string | null | undefined;
  bookingReference: string | null | undefined;
  startMin: number;
}): string {
  return contentId("item", [
    fields.tripId,
    fields.dayNumber,
    fields.candidateSourceKey,
    fields.bookingReference,
    fields.startMin
  ]);
}

/** Companion ledger entry ID: the action, its target, and its minute. */
export function companionLedgerEntryId(fields: {
  tripId: string;
  activityRef: string;
  classification: string;
  atMinuteOfTrip: number;
}): string {
  return contentId("ledger", [
    fields.tripId,
    fields.activityRef,
    fields.classification,
    fields.atMinuteOfTrip
  ]);
}

/** Prediction record ID: one immutable PREDICT record per trip lock. */
export function predictionId(fields: { tripId: string; packVersionId: string }): string {
  return contentId("pred", [fields.tripId, fields.packVersionId]);
}

/** Budget-vs-real observation ID: one per item per checkpoint fact. */
export function budgetObservationId(fields: {
  tripId: string;
  itemRef: string;
  checkpoint: string;
  realSource: string | null | undefined;
  realAmount: number | null | undefined;
}): string {
  return contentId("bvr", [
    fields.tripId,
    fields.itemRef,
    fields.checkpoint,
    fields.realSource,
    fields.realAmount
  ]);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Database row IDs are UUIDs; guards use this, builders never mint them. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
