/*
 * Build 2 trip lifecycle + purge (DESIGN-PRODUCTION.md Phase 11 —
 * the LAST wiring phase; migrations M4 + M5; the shadow machine is
 * part2-travel-days-2026-10-21/src/trip-lifecycle.mjs, SPEC §8,
 * proof 27/27, re-based to production shapes here).
 *
 * The machine: ACTIVE -> TRIP_ENDED -> POST_TRIP_PENDING -> CLOSED
 * -> PURGED, on the Phase 1 lifecycle DTO + legal-transition table.
 * CLOSED is entered on review submission OR on the review window
 * expiring (REVIEW_WINDOW_DAYS_DEFAULT days after trip end — Dylan's
 * default, labeled as such everywhere it surfaces; NOT an owner
 * ruling). At CLOSED the trip transitions to ARCHIVED.
 *
 * OWNER RULING (Junel, 2026-10-21 19:39 ADT, binding): "Purge the
 * panel and live copies; archive the purchased itinerary in the
 * account." The purge deletes ONLY the enumerated live copies —
 * panel state, cached day data, notifications + their delivery rows,
 * the lived companion ledger, the live item copies — and NEVER the
 * purchased itinerary: roamly_trips + roamly_itineraries transition
 * to archived and stay (entitlement + completion-email links keep
 * working). That is asserted by construction: the executor deletes
 * through PURGE_DELETE_TABLES, a closed constant, and the protected
 * tables appear nowhere in it.
 *
 * Guards, all fail-CLOSED:
 *  - mid-trip purge is impossible (refused at ACTIVE; refused while
 *    the post-trip loop is open at TRIP_ENDED / POST_TRIP_PENDING);
 *  - ingest-before-purge is a HARD ordering against Phase 10's seam
 *    state: a submitted review with no recorded ingest decision, or
 *    an eligible decision whose library row is missing, refuses the
 *    purge (recorded in the M4 history) and the sweep retries on its
 *    next run — the purge never improvises an ingest;
 *  - an FK precondition gate re-verifies the live FK expectations
 *    the purge depends on (the 2026-10-21 verified live map) before
 *    ANY delete: a drifted schema refuses + escalates, never
 *    improvises around it;
 *  - the M2 ledger deletes ONLY through the purge path: the store
 *    seam refuses a ledger delete that does not declare the purge
 *    (the database backstop is M4's roamly_purge_companion_ledger,
 *    which sets roamly.allow_purge inside its own transaction —
 *    exactly what M2's append-only trigger demands);
 *  - deletion is verified by re-read before the receipt is written:
 *    the M5 receipt claims exactly what is provable (governed online
 *    rows deleted + verified). Backup copies expire under the
 *    backup retention policy and are NOT claimed as deleted.
 *
 * The receipt is content-free (Phase 1 PurgeReceiptDTO — its parser
 * rejects any extra field) and lives in M5, a table with NO foreign
 * key: the trip is referenced only by the one-way SHA-256 hash of
 * its id, so the receipt survives the purge it proves. The M4
 * lifecycle row is retained as the trip's tombstone pointer: late
 * events, retries, and shared links check it and cannot resurrect a
 * purged trip.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "./engine/ids";
import {
  formatInstant,
  instantStringToLocal,
  parseInstant,
  type LocalDate,
  type UtcInstant
} from "./engine/time";
import {
  parseLifecycleStateDTO,
  parsePurgeReceiptDTO,
  type CloseReason,
  type LifecycleStateDTO,
  type LifecycleStateName,
  type PurgeReceiptDTO
} from "./engine/types";
import {
  SupabaseLibraryTripStore,
  type LibraryTripStore
} from "./libraryIngest";

export const LIFECYCLE_TABLE = "roamly_trip_lifecycle";
export const PURGE_RECEIPTS_TABLE = "roamly_purge_receipts";

/** Dylan's default — the owner has not set a different window.
 *  Labeled as a default everywhere it surfaces, never as a ruling. */
export const REVIEW_WINDOW_DAYS_DEFAULT = 7;
export const REVIEW_WINDOW_DEFAULT_SOURCE =
  "Dylan's default — 7 days after trip end; the owner has not set a different window";

export const PURGE_ACTOR_DEFAULT = "lifecycle-sweep";

/* ------------------------------------------------------------------ */
/* The purge scope — a closed enumeration                              */
/* ------------------------------------------------------------------ */

export type PurgeScope =
  | "notificationDeliveries"
  | "notifications"
  | "panelState"
  | "cachedDays"
  | "itineraryItems"
  | "ledger"
  | "liveCopies";

/**
 * Scope -> the ONE production table the executor may delete from.
 * Production mapping of the design's purge set:
 *  - panel state            -> roamly_trip_companion_events
 *  - cached day data        -> roamly_itinerary_days (the derived
 *    per-day rows; the canonical plan document is
 *    roamly_itineraries.full_json and is NEVER a target)
 *  - live item copies       -> roamly_trip_activities
 *  - notifications          -> roamly_notifications
 *  - notification deliveries-> roamly_companion_notification_deliveries
 *  - the lived ledger       -> roamly_companion_ledger (purge-flagged)
 * "liveCopies" has no table: it is the trip's live-serving itinerary
 * copy itself, whose materialized rows are the scopes above; the
 * executor retires it (and counts it) through the store seam once
 * the trip is archived — the archived document row is never deleted.
 */
export const PURGE_SCOPE_TABLES: Readonly<
  Record<Exclude<PurgeScope, "liveCopies">, string>
> = {
  notificationDeliveries: "roamly_companion_notification_deliveries",
  notifications: "roamly_notifications",
  panelState: "roamly_trip_companion_events",
  cachedDays: "roamly_itinerary_days",
  itineraryItems: "roamly_trip_activities",
  ledger: "roamly_companion_ledger"
};

/** The closed list of tables the purge executor may DELETE from. */
export const PURGE_DELETE_TABLES: readonly string[] = Object.values(
  PURGE_SCOPE_TABLES
);

/** Retention boundaries (design Phase 11): never purge targets. */
export const PURGE_PROTECTED_TABLES: readonly string[] = [
  "roamly_trips",
  "roamly_itineraries",
  "roamly_bookings",
  "roamly_booking_revisions",
  "roamly_payments",
  "roamly_user_entitlements",
  "roamly_email_logs",
  "roamly_library_trips",
  "roamly_trip_lifecycle",
  "roamly_purge_receipts",
  "roamly_push_subscriptions",
  "traveler_preference_events"
];

/* ------------------------------------------------------------------ */
/* FK precondition expectations (live map verified 2026-10-21)         */
/* ------------------------------------------------------------------ */

export interface FkExpectation {
  table: string;
  constraint: string;
  /** pg_constraint confdeltype: a=NO ACTION r=RESTRICT c=CASCADE n=SET NULL d=SET DEFAULT */
  deleteAction: string;
  meaning: string;
}

export const PURGE_FK_EXPECTATIONS: readonly FkExpectation[] = [
  {
    table: "roamly_trip_companion_events",
    constraint: "roamly_trip_companion_events_booking_id_fkey",
    deleteAction: "n",
    meaning: "SET NULL — companion events survive a booking delete (verified live, row 88-map)"
  },
  {
    table: "roamly_booking_revisions",
    constraint: "roamly_booking_revisions_trip_id_fkey",
    deleteAction: "a",
    meaning: "NO ACTION — revisions pin their trip; the purge never deletes trips or bookings, and this pin must still be there"
  },
  {
    table: "roamly_library_trips",
    constraint: "roamly_library_trips_trip_id_fkey",
    deleteAction: "r",
    meaning: "RESTRICT — M9's library link to the archived trip (Phase 10) must still guard it"
  }
];

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface LifecycleHistoryEntry {
  kind:
    | "transition"
    | "review"
    | "archive"
    | "ingest-decision"
    | "purge-refusal"
    | "escalation"
    | "purge"
    | "tombstone-ack";
  at: UtcInstant;
  state?: LifecycleStateName;
  code?: string;
  message?: string;
  decision?: { eligible: boolean; ingested: boolean };
}

export interface LifecycleRecord {
  tripId: string;
  userId: string;
  state: LifecycleStateName;
  timezone: string;
  dates: { start: LocalDate; end: LocalDate };
  reviewWindowDays: number;
  reviewWindowEndsAt: UtcInstant | null;
  endedAt: UtcInstant | null;
  reviewSentAt: UtcInstant | null;
  reviewSubmitted: boolean;
  reviewSubmittedAt: UtcInstant | null;
  closedAt: UtcInstant | null;
  closedReason: CloseReason | null;
  archive: { archivedAt: UtcInstant; itineraryRef: string } | null;
  purgedAt: UtcInstant | null;
  tombstoneAcknowledgedAt: UtcInstant | null;
  history: LifecycleHistoryEntry[];
  /** In-memory enrichment (the M5 row, merged by loadLifecycleDTO /
   *  set by executePurge). M4 stores only the receipt's hash ref. */
  purgeReceipt: PurgeReceiptDTO | null;
}

export function toLifecycleDTO(record: LifecycleRecord): LifecycleStateDTO {
  return {
    tripId: record.tripId,
    state: record.state,
    dates: record.dates,
    reviewWindowDays: record.reviewWindowDays,
    reviewWindowEndsAt: record.reviewWindowEndsAt,
    endedAt: record.endedAt,
    closedAt: record.closedAt,
    closedReason: record.closedReason,
    history: record.history
      .filter((entry) => entry.kind === "transition" && entry.state)
      .map((entry) => ({ state: entry.state as LifecycleStateName, at: entry.at })),
    archive: record.archive,
    purgeReceipt: record.purgeReceipt
  };
}

/** The receipt's trip reference: a one-way hash, never the id. */
export function tripRefForTrip(tripId: string): string {
  return sha256Hex(tripId);
}

/* ------------------------------------------------------------------ */
/* Store seams (Supabase + in-memory, the Phase 7/10 posture)          */
/* ------------------------------------------------------------------ */

export interface LifecycleStore {
  get(tripId: string): Promise<LifecycleRecord | null>;
  put(record: LifecycleRecord): Promise<void>;
  listByStates(states: readonly LifecycleStateName[]): Promise<LifecycleRecord[]>;
}

export interface PurgeReceiptStore {
  getByTripRef(tripRef: string): Promise<PurgeReceiptDTO | null>;
  insert(
    receipt: PurgeReceiptDTO,
    actor: string
  ): Promise<{ inserted: boolean; receipt: PurgeReceiptDTO }>;
}

export interface PurgeScopeCounts {
  notificationDeliveries: number;
  notifications: number;
  panelState: number;
  cachedDays: number;
  itineraryItems: number;
  ledgerEntries: number;
  liveCopies: number;
}

export interface TripLifecycleSeed {
  userId: string;
  timezone: string;
  dates: { start: LocalDate; end: LocalDate };
}

export interface PurgeDataStore {
  countScope(tripId: string, scope: PurgeScope): Promise<number>;
  /**
   * Delete one scope's rows for the trip; returns rows deleted.
   * The "ledger" scope REFUSES unless options.allowPurge is true —
   * the seam-level model of M2's append-only trigger.
   */
  deleteScope(
    tripId: string,
    scope: Exclude<PurgeScope, "liveCopies">,
    options?: { allowPurge?: boolean }
  ): Promise<number>;
  /** Retire the trip's live-serving copy; requires the archived
   *  trip (throws ARCHIVE_MISSING otherwise). Returns copies retired. */
  retireLiveCopies(tripId: string): Promise<number>;
  getItineraryDocument(
    tripId: string
  ): Promise<{ itineraryId: string; fullJson: string } | null>;
  getTripStatus(tripId: string): Promise<string | null>;
  archiveTrip(tripId: string): Promise<{ itineraryRef: string } | null>;
  getTripLifecycleSeed(tripId: string): Promise<TripLifecycleSeed | null>;
}

export interface FkCatalogPort {
  /** confdeltype character for the named FK, or null when absent.
   *  Implementations throw on read failure — the gate fails closed. */
  deleteAction(table: string, constraint: string): Promise<string | null>;
}

export interface IngestGateStatus {
  decisionRecorded: boolean;
  eligible: boolean;
  ingested: boolean;
}

export interface IngestGatePort {
  status(tripId: string): Promise<IngestGateStatus>;
}

export interface LifecycleDeps {
  lifecycle: LifecycleStore;
  receipts: PurgeReceiptStore;
  data: PurgeDataStore;
  ingestGate: IngestGatePort;
  fkCatalog: FkCatalogPort;
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export function isMissingLifecycleTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      /relation .* does not exist|schema cache|could not find the table/i.test(
        candidate.message
      ))
  );
}

/* ------------------------------------------------------------------ */
/* Lifecycle store (M4)                                                */
/* ------------------------------------------------------------------ */

interface LifecycleRow {
  trip_id: string;
  user_id: string;
  state: LifecycleStateName;
  trip_timezone: string;
  trip_start_date: string;
  trip_end_date: string;
  review_window_days: number;
  review_window_ends_at: string | null;
  ended_at: string | null;
  review_sent_at: string | null;
  review_submitted: boolean;
  review_submitted_at: string | null;
  closed_at: string | null;
  close_reason: CloseReason | null;
  archived_at: string | null;
  archived_itinerary_ref: string | null;
  purged_at: string | null;
  tombstone_acknowledged_at: string | null;
  history: LifecycleHistoryEntry[];
}

function recordFromRow(row: LifecycleRow): LifecycleRecord {
  return {
    tripId: row.trip_id,
    userId: row.user_id,
    state: row.state,
    timezone: row.trip_timezone,
    dates: { start: row.trip_start_date, end: row.trip_end_date },
    reviewWindowDays: row.review_window_days,
    reviewWindowEndsAt: row.review_window_ends_at,
    endedAt: row.ended_at,
    reviewSentAt: row.review_sent_at,
    reviewSubmitted: row.review_submitted,
    reviewSubmittedAt: row.review_submitted_at,
    closedAt: row.closed_at,
    closedReason: row.close_reason,
    archive:
      row.archived_at && row.archived_itinerary_ref
        ? { archivedAt: row.archived_at, itineraryRef: row.archived_itinerary_ref }
        : null,
    purgedAt: row.purged_at,
    tombstoneAcknowledgedAt: row.tombstone_acknowledged_at,
    history: Array.isArray(row.history) ? row.history : [],
    purgeReceipt: null
  };
}

function rowFromRecord(record: LifecycleRecord): LifecycleRow {
  return {
    trip_id: record.tripId,
    user_id: record.userId,
    state: record.state,
    trip_timezone: record.timezone,
    trip_start_date: record.dates.start,
    trip_end_date: record.dates.end,
    review_window_days: record.reviewWindowDays,
    review_window_ends_at: record.reviewWindowEndsAt,
    ended_at: record.endedAt,
    review_sent_at: record.reviewSentAt,
    review_submitted: record.reviewSubmitted,
    review_submitted_at: record.reviewSubmittedAt,
    closed_at: record.closedAt,
    close_reason: record.closedReason,
    archived_at: record.archive?.archivedAt ?? null,
    archived_itinerary_ref: record.archive?.itineraryRef ?? null,
    purged_at: record.purgedAt,
    tombstone_acknowledged_at: record.tombstoneAcknowledgedAt,
    history: record.history
  };
}

const LIFECYCLE_COLUMNS =
  "trip_id, user_id, state, trip_timezone, trip_start_date, trip_end_date, review_window_days, review_window_ends_at, ended_at, review_sent_at, review_submitted, review_submitted_at, closed_at, close_reason, archived_at, archived_itinerary_ref, purged_at, tombstone_acknowledged_at, history";

export class SupabaseLifecycleStore implements LifecycleStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async get(tripId: string): Promise<LifecycleRecord | null> {
    const { data, error } = await this.supabase
      .from(LIFECYCLE_TABLE)
      .select(LIFECYCLE_COLUMNS)
      .eq("trip_id", tripId)
      .maybeSingle();
    if (error) {
      if (isMissingLifecycleTableError(error)) return null;
      throw error;
    }
    return data ? recordFromRow(data as LifecycleRow) : null;
  }

  async put(record: LifecycleRecord): Promise<void> {
    const { error } = await this.supabase
      .from(LIFECYCLE_TABLE)
      .upsert(rowFromRecord(record), { onConflict: "trip_id" });
    if (error) throw error;
  }

  async listByStates(
    states: readonly LifecycleStateName[]
  ): Promise<LifecycleRecord[]> {
    const { data, error } = await this.supabase
      .from(LIFECYCLE_TABLE)
      .select(LIFECYCLE_COLUMNS)
      .in("state", [...states])
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      if (isMissingLifecycleTableError(error)) return [];
      throw error;
    }
    return (data || []).map((row) => recordFromRow(row as LifecycleRow));
  }
}

export class InMemoryLifecycleStore implements LifecycleStore {
  private readonly records = new Map<string, LifecycleRecord>();

  async get(tripId: string): Promise<LifecycleRecord | null> {
    const record = this.records.get(tripId);
    return record ? structuredClone(record) : null;
  }

  async put(record: LifecycleRecord): Promise<void> {
    this.records.set(record.tripId, structuredClone(record));
  }

  async listByStates(
    states: readonly LifecycleStateName[]
  ): Promise<LifecycleRecord[]> {
    return [...this.records.values()]
      .filter((record) => states.includes(record.state))
      .map((record) => structuredClone(record));
  }
}

/* ------------------------------------------------------------------ */
/* Purge receipt store (M5 — no FK; the receipt outlives the trip)     */
/* ------------------------------------------------------------------ */

interface PurgeReceiptRow {
  trip_ref: string;
  trip_start_date: string;
  trip_end_date: string;
  purged_at: string;
  close_reason: CloseReason;
  review_window_days: number;
  deleted_notifications: number;
  deleted_cached_days: number;
  deleted_ledger_entries: number;
  deleted_itinerary_items: number;
  deleted_live_copies: number;
  library_retained: boolean;
}

function receiptFromRow(row: PurgeReceiptRow): PurgeReceiptDTO {
  return {
    tripRef: row.trip_ref,
    dates: { start: row.trip_start_date, end: row.trip_end_date },
    purgedAt: row.purged_at,
    closedReason: row.close_reason,
    reviewWindowDays: row.review_window_days,
    deletedCounts: {
      notifications: row.deleted_notifications,
      cachedDays: row.deleted_cached_days,
      ledgerEntries: row.deleted_ledger_entries,
      itineraryItems: row.deleted_itinerary_items,
      liveCopies: row.deleted_live_copies
    },
    libraryRetained: row.library_retained
  };
}

function rowFromReceipt(receipt: PurgeReceiptDTO, actor: string): PurgeReceiptRow & { actor: string } {
  return {
    trip_ref: receipt.tripRef,
    trip_start_date: receipt.dates.start,
    trip_end_date: receipt.dates.end,
    purged_at: receipt.purgedAt,
    close_reason: receipt.closedReason,
    review_window_days: receipt.reviewWindowDays,
    deleted_notifications: receipt.deletedCounts.notifications,
    deleted_cached_days: receipt.deletedCounts.cachedDays,
    deleted_ledger_entries: receipt.deletedCounts.ledgerEntries,
    deleted_itinerary_items: receipt.deletedCounts.itineraryItems,
    deleted_live_copies: receipt.deletedCounts.liveCopies,
    library_retained: receipt.libraryRetained,
    actor
  };
}

const RECEIPT_COLUMNS =
  "trip_ref, trip_start_date, trip_end_date, purged_at, close_reason, review_window_days, deleted_notifications, deleted_cached_days, deleted_ledger_entries, deleted_itinerary_items, deleted_live_copies, library_retained";

export class SupabasePurgeReceiptStore implements PurgeReceiptStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async getByTripRef(tripRef: string): Promise<PurgeReceiptDTO | null> {
    const { data, error } = await this.supabase
      .from(PURGE_RECEIPTS_TABLE)
      .select(RECEIPT_COLUMNS)
      .eq("trip_ref", tripRef)
      .maybeSingle();
    if (error) {
      if (isMissingLifecycleTableError(error)) return null;
      throw error;
    }
    return data ? receiptFromRow(data as PurgeReceiptRow) : null;
  }

  async insert(
    receipt: PurgeReceiptDTO,
    actor: string
  ): Promise<{ inserted: boolean; receipt: PurgeReceiptDTO }> {
    const existing = await this.getByTripRef(receipt.tripRef);
    if (existing) return { inserted: false, receipt: existing };
    const { error } = await this.supabase
      .from(PURGE_RECEIPTS_TABLE)
      .insert(rowFromReceipt(receipt, actor));
    if (error) throw error;
    return { inserted: true, receipt };
  }
}

export class InMemoryPurgeReceiptStore implements PurgeReceiptStore {
  private readonly receipts = new Map<string, PurgeReceiptDTO>();

  async getByTripRef(tripRef: string): Promise<PurgeReceiptDTO | null> {
    const receipt = this.receipts.get(tripRef);
    return receipt ? structuredClone(receipt) : null;
  }

  async insert(
    receipt: PurgeReceiptDTO
  ): Promise<{ inserted: boolean; receipt: PurgeReceiptDTO }> {
    const existing = this.receipts.get(receipt.tripRef);
    if (existing) return { inserted: false, receipt: structuredClone(existing) };
    this.receipts.set(receipt.tripRef, structuredClone(receipt));
    return { inserted: true, receipt: structuredClone(receipt) };
  }

  get size(): number {
    return this.receipts.size;
  }
}

/* ------------------------------------------------------------------ */
/* Purge data store (the enumerated scopes + the archive seam)         */
/* ------------------------------------------------------------------ */

export class SupabasePurgeDataStore implements PurgeDataStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async countScope(tripId: string, scope: PurgeScope): Promise<number> {
    if (scope === "liveCopies") {
      const { count, error } = await this.supabase
        .from("roamly_itineraries")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", tripId);
      if (error) throw error;
      return count ?? 0;
    }
    const { count, error } = await this.supabase
      .from(PURGE_SCOPE_TABLES[scope])
      .select("*", { count: "exact", head: true })
      .eq("trip_id", tripId);
    if (error) throw error;
    return count ?? 0;
  }

  async deleteScope(
    tripId: string,
    scope: Exclude<PurgeScope, "liveCopies">,
    options?: { allowPurge?: boolean }
  ): Promise<number> {
    if (scope === "ledger") {
      // The seam refuses first; M2's trigger + M4's purge function
      // are the database backstops behind this same contract.
      if (options?.allowPurge !== true) {
        throw codedError(
          "LEDGER_PURGE_FLAG_REQUIRED",
          "roamly_companion_ledger is append-only: DELETE requires the Phase 11 purge (roamly.allow_purge = 'on')"
        );
      }
      const { data, error } = await this.supabase.rpc(
        "roamly_purge_companion_ledger",
        { p_trip_id: tripId }
      );
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    }
    const { count, error } = await this.supabase
      .from(PURGE_SCOPE_TABLES[scope])
      .delete({ count: "exact" })
      .eq("trip_id", tripId);
    if (error) throw error;
    return count ?? 0;
  }

  async retireLiveCopies(tripId: string): Promise<number> {
    const status = await this.getTripStatus(tripId);
    if (status !== "archived") {
      throw codedError(
        "ARCHIVE_MISSING",
        `trip ${tripId} is not archived (status: ${status ?? "missing"}) — live copies cannot retire before the archive transition`
      );
    }
    return this.countScope(tripId, "liveCopies");
  }

  async getItineraryDocument(
    tripId: string
  ): Promise<{ itineraryId: string; fullJson: string } | null> {
    const { data, error } = await this.supabase
      .from("roamly_itineraries")
      .select("id, full_json")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as { id: string; full_json: unknown };
    return { itineraryId: row.id, fullJson: JSON.stringify(row.full_json) };
  }

  async getTripStatus(tripId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("roamly_trips")
      .select("status")
      .eq("id", tripId)
      .maybeSingle();
    if (error) throw error;
    return data ? String((data as { status: unknown }).status) : null;
  }

  async archiveTrip(tripId: string): Promise<{ itineraryRef: string } | null> {
    const { data, error } = await this.supabase
      .from("roamly_trips")
      .update({ status: "archived" })
      .eq("id", tripId)
      .select("id");
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) return null;
    const document = await this.getItineraryDocument(tripId);
    return { itineraryRef: document?.itineraryId ?? `archive:${tripId}` };
  }

  async getTripLifecycleSeed(tripId: string): Promise<TripLifecycleSeed | null> {
    const { data, error } = await this.supabase
      .from("roamly_trips")
      .select("user_id, timezone, start_date, end_date, metadata")
      .eq("id", tripId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as {
      user_id: string;
      timezone: string | null;
      start_date: string | null;
      end_date: string | null;
      metadata: unknown;
    };
    if (!row.start_date || !row.end_date) return null;
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as { timezone?: unknown })
        : {};
    const timezone =
      row.timezone ||
      (typeof metadata.timezone === "string" ? metadata.timezone : "UTC");
    return {
      userId: row.user_id,
      timezone,
      dates: { start: row.start_date, end: row.end_date }
    };
  }
}

/** A purge-scope row in the in-memory store: payload is opaque bytes
 *  so proofs can assert byte-identity of anything that must survive. */
export interface PurgeFixtureRow {
  id: string;
  tripId: string;
  payload: string;
}

export class InMemoryPurgeDataStore implements PurgeDataStore {
  readonly collections: Record<
    Exclude<PurgeScope, "liveCopies" | "ledger">,
    PurgeFixtureRow[]
  > = {
    notificationDeliveries: [],
    notifications: [],
    panelState: [],
    cachedDays: [],
    itineraryItems: []
  };
  readonly ledgerRows: PurgeFixtureRow[] = [];
  readonly liveCopyRecords: { tripId: string; copyRef: string }[] = [];
  readonly trips = new Map<
    string,
    { userId: string; status: string; timezone: string; startDate: string; endDate: string }
  >();
  readonly itineraries = new Map<string, { id: string; fullJson: string }>();
  readonly deleteLog: { scope: PurgeScope; tripId: string; count: number }[] = [];

  addRow(scope: Exclude<PurgeScope, "liveCopies">, row: PurgeFixtureRow): void {
    if (scope === "ledger") this.ledgerRows.push(row);
    else this.collections[scope].push(row);
  }

  addTrip(
    tripId: string,
    seed: { userId: string; status: string; timezone: string; startDate: string; endDate: string }
  ): void {
    this.trips.set(tripId, { ...seed });
  }

  addItinerary(tripId: string, itinerary: { id: string; fullJson: string }): void {
    this.itineraries.set(tripId, { ...itinerary });
  }

  addLiveCopy(tripId: string, copyRef: string): void {
    this.liveCopyRecords.push({ tripId, copyRef });
  }

  async countScope(tripId: string, scope: PurgeScope): Promise<number> {
    if (scope === "liveCopies")
      return this.liveCopyRecords.filter((copy) => copy.tripId === tripId).length;
    if (scope === "ledger")
      return this.ledgerRows.filter((row) => row.tripId === tripId).length;
    return this.collections[scope].filter((row) => row.tripId === tripId).length;
  }

  async deleteScope(
    tripId: string,
    scope: Exclude<PurgeScope, "liveCopies">,
    options?: { allowPurge?: boolean }
  ): Promise<number> {
    if (scope === "ledger") {
      // The M2 trigger, modeled at the seam: no purge declaration,
      // no delete — for every caller, including this executor.
      if (options?.allowPurge !== true) {
        throw codedError(
          "LEDGER_PURGE_FLAG_REQUIRED",
          "roamly_companion_ledger is append-only: DELETE requires the Phase 11 purge (roamly.allow_purge = 'on')"
        );
      }
      const before = this.ledgerRows.length;
      for (let i = this.ledgerRows.length - 1; i >= 0; i--) {
        if (this.ledgerRows[i].tripId === tripId) this.ledgerRows.splice(i, 1);
      }
      const count = before - this.ledgerRows.length;
      this.deleteLog.push({ scope, tripId, count });
      return count;
    }
    const rows = this.collections[scope];
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].tripId === tripId) rows.splice(i, 1);
    }
    const count = before - rows.length;
    this.deleteLog.push({ scope, tripId, count });
    return count;
  }

  async retireLiveCopies(tripId: string): Promise<number> {
    const trip = this.trips.get(tripId);
    if (!trip || trip.status !== "archived") {
      throw codedError(
        "ARCHIVE_MISSING",
        `trip ${tripId} is not archived (status: ${trip?.status ?? "missing"}) — live copies cannot retire before the archive transition`
      );
    }
    const before = this.liveCopyRecords.length;
    for (let i = this.liveCopyRecords.length - 1; i >= 0; i--) {
      if (this.liveCopyRecords[i].tripId === tripId)
        this.liveCopyRecords.splice(i, 1);
    }
    const count = before - this.liveCopyRecords.length;
    this.deleteLog.push({ scope: "liveCopies", tripId, count });
    return count;
  }

  async getItineraryDocument(
    tripId: string
  ): Promise<{ itineraryId: string; fullJson: string } | null> {
    const itinerary = this.itineraries.get(tripId);
    return itinerary
      ? { itineraryId: itinerary.id, fullJson: itinerary.fullJson }
      : null;
  }

  async getTripStatus(tripId: string): Promise<string | null> {
    return this.trips.get(tripId)?.status ?? null;
  }

  async archiveTrip(tripId: string): Promise<{ itineraryRef: string } | null> {
    const trip = this.trips.get(tripId);
    if (!trip) return null;
    trip.status = "archived";
    return {
      itineraryRef: this.itineraries.get(tripId)?.id ?? `archive:${tripId}`
    };
  }

  async getTripLifecycleSeed(tripId: string): Promise<TripLifecycleSeed | null> {
    const trip = this.trips.get(tripId);
    if (!trip) return null;
    return {
      userId: trip.userId,
      timezone: trip.timezone,
      dates: { start: trip.startDate, end: trip.endDate }
    };
  }
}

/* ------------------------------------------------------------------ */
/* FK catalog                                                          */
/* ------------------------------------------------------------------ */

export class SupabaseFkCatalog implements FkCatalogPort {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async deleteAction(table: string, constraint: string): Promise<string | null> {
    const { data, error } = await this.supabase.rpc("roamly_fk_delete_action", {
      p_table_name: table,
      p_constraint_name: constraint
    });
    if (error) throw error;
    return typeof data === "string" ? data : null;
  }
}

export class InMemoryFkCatalog implements FkCatalogPort {
  private readonly actions = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.actions.set(key, value);
  }

  static key(table: string, constraint: string): string {
    return `${table}::${constraint}`;
  }

  set(table: string, constraint: string, action: string | null): void {
    const key = InMemoryFkCatalog.key(table, constraint);
    if (action === null) this.actions.delete(key);
    else this.actions.set(key, action);
  }

  async deleteAction(table: string, constraint: string): Promise<string | null> {
    return this.actions.get(InMemoryFkCatalog.key(table, constraint)) ?? null;
  }
}

/** The FK catalog as verified live on 2026-10-21 (88-row map): the
 *  three expectations this purge depends on, at their live actions. */
export function verifiedLiveFkCatalog(): InMemoryFkCatalog {
  const seed: Record<string, string> = {};
  for (const expectation of PURGE_FK_EXPECTATIONS) {
    seed[InMemoryFkCatalog.key(expectation.table, expectation.constraint)] =
      expectation.deleteAction;
  }
  return new InMemoryFkCatalog(seed);
}

/* ------------------------------------------------------------------ */
/* Ingest gate (Phase 10's seam state)                                 */
/* ------------------------------------------------------------------ */

/**
 * The purge's view of Phase 10: decisions are read from BOTH durable
 * homes — the lifecycle history (M4, where the tripFeedback seam
 * records them via recordIngestDecision) and the library store's
 * decision list — and "ingested" is the M9 row's existence. A trip
 * owes an ingest when a review was submitted but no decision is
 * recorded anywhere, or the decision says eligible and the row is
 * missing.
 */
export function ingestGateFromStores(stores: {
  library: LibraryTripStore;
  lifecycle: LifecycleStore;
}): IngestGatePort {
  return {
    async status(tripId: string): Promise<IngestGateStatus> {
      const [row, decisions, record] = await Promise.all([
        stores.library.getByTripId(tripId),
        stores.library.listDecisions(tripId),
        stores.lifecycle.get(tripId)
      ]);
      let eligible: boolean | null = null;
      if (decisions.length > 0) eligible = decisions[decisions.length - 1].eligible;
      if (record) {
        for (const entry of record.history) {
          if (entry.kind === "ingest-decision" && entry.decision) {
            eligible = entry.decision.eligible;
          }
        }
      }
      return {
        decisionRecorded: decisions.length > 0 || eligible !== null,
        eligible: eligible ?? false,
        ingested: row !== null
      };
    }
  };
}

export function createLifecycleDeps(supabase: SupabaseClient): LifecycleDeps {
  const lifecycle = new SupabaseLifecycleStore(supabase);
  return {
    lifecycle,
    receipts: new SupabasePurgeReceiptStore(supabase),
    data: new SupabasePurgeDataStore(supabase),
    ingestGate: ingestGateFromStores({
      library: new SupabaseLibraryTripStore(supabase),
      lifecycle
    }),
    fkCatalog: new SupabaseFkCatalog(supabase)
  };
}

/* ------------------------------------------------------------------ */
/* The state machine                                                   */
/* ------------------------------------------------------------------ */

function transition(
  record: LifecycleRecord,
  state: LifecycleStateName,
  at: UtcInstant
): void {
  record.state = state;
  record.history.push({ kind: "transition", state, at });
}

function tripHasEnded(record: LifecycleRecord, now: UtcInstant): boolean {
  // The trip has ended when the trip-local civil date has moved past
  // the final trip date (Phase 1 time adapter — never server-local).
  return instantStringToLocal(now, record.timezone).date > record.dates.end;
}

function windowEndsAt(endedAt: UtcInstant, days: number): UtcInstant {
  return formatInstant(parseInstant(endedAt) + days * 86_400_000);
}

export async function ensureLifecycleRecord(
  deps: LifecycleDeps,
  input: TripLifecycleSeed & {
    tripId: string;
    reviewWindowDays?: number;
    now: UtcInstant;
  }
): Promise<{ record: LifecycleRecord; created: boolean }> {
  const existing = await deps.lifecycle.get(input.tripId);
  if (existing) return { record: existing, created: false };
  const record: LifecycleRecord = {
    tripId: input.tripId,
    userId: input.userId,
    state: "ACTIVE",
    timezone: input.timezone,
    dates: input.dates,
    reviewWindowDays: input.reviewWindowDays ?? REVIEW_WINDOW_DAYS_DEFAULT,
    reviewWindowEndsAt: null,
    endedAt: null,
    reviewSentAt: null,
    reviewSubmitted: false,
    reviewSubmittedAt: null,
    closedAt: null,
    closedReason: null,
    archive: null,
    purgedAt: null,
    tombstoneAcknowledgedAt: null,
    history: [{ kind: "transition", state: "ACTIVE", at: input.now }],
    purgeReceipt: null
  };
  await deps.lifecycle.put(record);
  return { record, created: true };
}

async function endTripRecord(
  deps: LifecycleDeps,
  record: LifecycleRecord,
  now: UtcInstant
): Promise<void> {
  record.endedAt = now;
  record.reviewWindowEndsAt = windowEndsAt(now, record.reviewWindowDays);
  transition(record, "TRIP_ENDED", now);
  await deps.lifecycle.put(record);
}

/** TRIP_ENDED -> POST_TRIP_PENDING: the post-trip review email has
 *  been composed from the as-lived record and sent (Phase 10). */
export async function recordReviewEmailSent(
  deps: LifecycleDeps,
  tripId: string,
  now: UtcInstant
): Promise<{ ok: boolean; reason: string | null }> {
  const record = await deps.lifecycle.get(tripId);
  if (!record) return { ok: false, reason: "NO_LIFECYCLE_RECORD" };
  if (record.state === "POST_TRIP_PENDING")
    return { ok: true, reason: "already-pending" };
  if (record.state !== "TRIP_ENDED")
    return { ok: false, reason: `state is ${record.state}` };
  record.reviewSentAt = now;
  record.history.push({ kind: "review", at: now, message: "review email sent" });
  transition(record, "POST_TRIP_PENDING", now);
  await deps.lifecycle.put(record);
  return { ok: true, reason: null };
}

async function archiveIfNeeded(
  deps: LifecycleDeps,
  record: LifecycleRecord,
  now: UtcInstant
): Promise<void> {
  if (record.archive) return;
  const result = await deps.data.archiveTrip(record.tripId);
  if (!result) {
    record.history.push({
      kind: "escalation",
      at: now,
      code: "ARCHIVE_TRIP_ROW_MISSING",
      message: `trip row ${record.tripId} not found at archive time; ref fell back to the trip id`
    });
  }
  record.archive = {
    archivedAt: now,
    itineraryRef: result?.itineraryRef ?? `archive:${record.tripId}`
  };
  record.history.push({ kind: "archive", at: now });
}

async function closeRecord(
  deps: LifecycleDeps,
  record: LifecycleRecord,
  reason: CloseReason,
  now: UtcInstant
): Promise<void> {
  record.closedAt = now;
  record.closedReason = reason;
  transition(record, "CLOSED", now);
  await archiveIfNeeded(deps, record, now);
  await deps.lifecycle.put(record);
}

/**
 * The review-submission close (the tripFeedback seam calls this
 * after a post-trip feedback save): mark the submission, walk the
 * legal chain to CLOSED (reason: review-submitted), and archive.
 * Idempotent — a second submission changes nothing.
 */
export async function recordReviewSubmission(
  deps: LifecycleDeps,
  tripId: string,
  now: UtcInstant
): Promise<{ ok: boolean; code: string | null; state: LifecycleStateName | null }> {
  const record = await deps.lifecycle.get(tripId);
  if (!record) return { ok: false, code: "NO_LIFECYCLE_RECORD", state: null };
  if (record.state === "PURGED")
    return { ok: false, code: "TRIP_PURGED", state: record.state };
  if (record.reviewSubmitted && record.state === "CLOSED") {
    return { ok: true, code: "already-closed", state: record.state };
  }
  if (record.state === "ACTIVE") {
    if (!tripHasEnded(record, now)) {
      return { ok: false, code: "REVIEW_BEFORE_TRIP_END", state: record.state };
    }
    record.endedAt = now;
    record.reviewWindowEndsAt = windowEndsAt(now, record.reviewWindowDays);
    transition(record, "TRIP_ENDED", now);
  }
  if (record.state === "TRIP_ENDED") {
    if (!record.reviewSentAt) record.reviewSentAt = now;
    transition(record, "POST_TRIP_PENDING", now);
  }
  record.reviewSubmitted = true;
  record.reviewSubmittedAt = now;
  record.history.push({ kind: "review", at: now, message: "review submitted" });
  if (record.state === "POST_TRIP_PENDING") {
    await closeRecord(deps, record, "review-submitted", now);
  } else {
    await deps.lifecycle.put(record);
  }
  return { ok: true, code: null, state: record.state };
}

/** Record a Phase 10 ingest decision into the M4 history — its
 *  durable home (Phase 10 report). Called by the tripFeedback seam
 *  with the seam's own result; the purge gate reads it back. */
export async function recordIngestDecision(
  deps: LifecycleDeps,
  tripId: string,
  decision: { eligible: boolean; ingested: boolean },
  now: UtcInstant
): Promise<void> {
  const record = await deps.lifecycle.get(tripId);
  if (!record) return;
  record.history.push({ kind: "ingest-decision", at: now, decision });
  await deps.lifecycle.put(record);
}

/* ------------------------------------------------------------------ */
/* The purge executor                                                  */
/* ------------------------------------------------------------------ */

export type PurgeRefusalCode =
  | "NO_LIFECYCLE_RECORD"
  | "RECEIPT_MISSING"
  | "PURGE_BEFORE_TRIP_END"
  | "PURGE_BEFORE_CLOSE"
  | "CLOSE_REASON_MISSING"
  | "INGEST_DECISION_OUTSTANDING"
  | "INGEST_BEFORE_PURGE"
  | "FK_PRECONDITION_FAILED"
  | "ARCHIVE_MISSING"
  | "PURGE_VERIFY_FAILED";

export type PurgeResult =
  | {
      ok: true;
      alreadyPurged: boolean;
      receipt: PurgeReceiptDTO;
      detail: PurgeScopeCounts;
    }
  | { ok: false; code: PurgeRefusalCode; message: string };

async function recordRefusal(
  deps: LifecycleDeps,
  record: LifecycleRecord,
  code: PurgeRefusalCode,
  message: string,
  now: UtcInstant
): Promise<PurgeResult> {
  record.history.push({
    kind: code === "FK_PRECONDITION_FAILED" ? "escalation" : "purge-refusal",
    at: now,
    code,
    message
  });
  await deps.lifecycle.put(record);
  return { ok: false, code, message };
}

const EMPTY_DETAIL: PurgeScopeCounts = {
  notificationDeliveries: 0,
  notifications: 0,
  panelState: 0,
  cachedDays: 0,
  itineraryItems: 0,
  ledgerEntries: 0,
  liveCopies: 0
};

export async function executePurge(
  deps: LifecycleDeps,
  tripId: string,
  now: UtcInstant,
  options?: { actor?: string }
): Promise<PurgeResult> {
  const actor = options?.actor ?? PURGE_ACTOR_DEFAULT;
  const record = await deps.lifecycle.get(tripId);
  if (!record) {
    return {
      ok: false,
      code: "NO_LIFECYCLE_RECORD",
      message: `no lifecycle record for trip ${tripId}`
    };
  }
  const tripRef = tripRefForTrip(tripId);

  if (record.state === "PURGED") {
    const receipt =
      record.purgeReceipt ?? (await deps.receipts.getByTripRef(tripRef));
    if (!receipt) {
      return {
        ok: false,
        code: "RECEIPT_MISSING",
        message: `trip ${tripId} is PURGED but no M5 receipt exists — escalated, nothing touched`
      };
    }
    // Idempotent: a second purge is a no-op; the receipt is unchanged.
    return { ok: true, alreadyPurged: true, receipt, detail: { ...EMPTY_DETAIL } };
  }
  if (record.state === "ACTIVE") {
    return recordRefusal(
      deps,
      record,
      "PURGE_BEFORE_TRIP_END",
      "a purge can never run before the trip has ended",
      now
    );
  }
  if (record.state === "TRIP_ENDED" || record.state === "POST_TRIP_PENDING") {
    return recordRefusal(
      deps,
      record,
      "PURGE_BEFORE_CLOSE",
      "the post-trip loop is still open — the trip closes on review submission or window expiry, and only then purges",
      now
    );
  }
  // state === CLOSED from here.
  if (!record.closedReason) {
    return recordRefusal(
      deps,
      record,
      "CLOSE_REASON_MISSING",
      "trip is CLOSED without a close reason — refusing rather than guessing",
      now
    );
  }
  await archiveIfNeeded(deps, record, now);
  await deps.lifecycle.put(record);

  // A receipt from an interrupted earlier run means the deletes
  // already landed: finish the record, never re-delete.
  const priorReceipt = await deps.receipts.getByTripRef(tripRef);
  if (priorReceipt) {
    record.purgeReceipt = priorReceipt;
    record.purgedAt = priorReceipt.purgedAt;
    transition(record, "PURGED", now);
    record.history.push({ kind: "purge", at: now, message: "completed from prior receipt" });
    await deps.lifecycle.put(record);
    return {
      ok: true,
      alreadyPurged: true,
      receipt: priorReceipt,
      detail: { ...EMPTY_DETAIL }
    };
  }

  // HARD ORDERING — ingest before purge (Phase 10 seam state).
  const gate = await deps.ingestGate.status(tripId);
  if (record.reviewSubmitted && !gate.decisionRecorded) {
    return recordRefusal(
      deps,
      record,
      "INGEST_DECISION_OUTSTANDING",
      "a review was submitted but Phase 10 has recorded no ingest decision — purge refuses and retries next sweep",
      now
    );
  }
  if (gate.eligible && !gate.ingested) {
    return recordRefusal(
      deps,
      record,
      "INGEST_BEFORE_PURGE",
      "this trip's ingest decision is eligible but no library record exists — ingest must happen before purge",
      now
    );
  }

  // FK PRECONDITION GATE — verify the live schema still matches the
  // expectations the purge depends on; drift refuses + escalates.
  for (const expectation of PURGE_FK_EXPECTATIONS) {
    let action: string | null;
    try {
      action = await deps.fkCatalog.deleteAction(
        expectation.table,
        expectation.constraint
      );
    } catch {
      action = null;
    }
    if (action !== expectation.deleteAction) {
      return recordRefusal(
        deps,
        record,
        "FK_PRECONDITION_FAILED",
        `FK drift: ${expectation.table}.${expectation.constraint} expected confdeltype '${expectation.deleteAction}' (${expectation.meaning}), found '${action ?? "absent"}' — purge refused, nothing deleted`,
        now
      );
    }
  }

  // The archive is a precondition of retiring live copies.
  const tripStatus = await deps.data.getTripStatus(tripId);
  if (tripStatus !== "archived") {
    return recordRefusal(
      deps,
      record,
      "ARCHIVE_MISSING",
      `trip status is '${tripStatus ?? "missing"}', not 'archived' — the purchased itinerary must be archived before its live copies purge`,
      now
    );
  }

  // THE DELETES — only the enumerated scopes, only for this trip.
  // Order: delivery rows first (they reference notifications), then
  // notifications, panel state, cached days, item copies, and the
  // lived ledger LAST through the purge-flagged path.
  const detail: PurgeScopeCounts = { ...EMPTY_DETAIL };
  detail.notificationDeliveries = await deps.data.deleteScope(tripId, "notificationDeliveries");
  detail.notifications = await deps.data.deleteScope(tripId, "notifications");
  detail.panelState = await deps.data.deleteScope(tripId, "panelState");
  detail.cachedDays = await deps.data.deleteScope(tripId, "cachedDays");
  detail.itineraryItems = await deps.data.deleteScope(tripId, "itineraryItems");
  detail.ledgerEntries = await deps.data.deleteScope(tripId, "ledger", {
    allowPurge: true
  });
  detail.liveCopies = await deps.data.retireLiveCopies(tripId);

  // Verify by re-read — the receipt claims only verified deletion.
  const remaining: string[] = [];
  for (const scope of [
    "notificationDeliveries",
    "notifications",
    "panelState",
    "cachedDays",
    "itineraryItems",
    "ledger",
    "liveCopies"
  ] as const) {
    if ((await deps.data.countScope(tripId, scope)) > 0) remaining.push(scope);
  }
  if (remaining.length > 0) {
    return recordRefusal(
      deps,
      record,
      "PURGE_VERIFY_FAILED",
      `post-delete re-read still finds rows in: ${remaining.join(", ")} — receipt NOT written; the sweep retries (completed scopes re-delete as no-ops)`,
      now
    );
  }

  const receipt: PurgeReceiptDTO = {
    tripRef,
    dates: record.dates,
    purgedAt: now,
    closedReason: record.closedReason,
    reviewWindowDays: record.reviewWindowDays,
    deletedCounts: {
      notifications: detail.notifications,
      cachedDays: detail.cachedDays,
      ledgerEntries: detail.ledgerEntries,
      itineraryItems: detail.itineraryItems,
      liveCopies: detail.liveCopies
    },
    libraryRetained: gate.ingested
  };
  const parsed = parsePurgeReceiptDTO(receipt);
  if (!parsed.ok) {
    throw codedError(
      "RECEIPT_INVALID",
      `purge receipt failed its own content-free parser: ${parsed.errors.join("; ")}`
    );
  }
  const { receipt: storedReceipt } = await deps.receipts.insert(receipt, actor);

  record.purgeReceipt = storedReceipt;
  record.purgedAt = now;
  transition(record, "PURGED", now);
  record.history.push({ kind: "purge", at: now, message: `actor: ${actor}` });
  await deps.lifecycle.put(record);
  return { ok: true, alreadyPurged: false, receipt: storedReceipt, detail };
}

/* ------------------------------------------------------------------ */
/* Advance + sweep (the cron's driver)                                 */
/* ------------------------------------------------------------------ */

export interface AdvanceResult {
  tripId: string;
  from: LifecycleStateName;
  to: LifecycleStateName;
  actions: string[];
  purge: PurgeResult | null;
}

export async function advanceLifecycle(
  deps: LifecycleDeps,
  tripId: string,
  now: UtcInstant,
  options: { purgeEnabled: boolean; actor?: string }
): Promise<AdvanceResult | null> {
  const record = await deps.lifecycle.get(tripId);
  if (!record) return null;
  const from = record.state;
  const actions: string[] = [];

  if (record.state === "PURGED") {
    // The tombstone is terminal: nothing advances, nothing resurrects.
    return { tripId, from, to: record.state, actions, purge: null };
  }
  if (record.state === "ACTIVE" && tripHasEnded(record, now)) {
    await endTripRecord(deps, record, now);
    actions.push("ended");
  }
  const current = await deps.lifecycle.get(tripId);
  if (!current) return { tripId, from, to: from, actions, purge: null };

  if (current.state === "POST_TRIP_PENDING") {
    if (current.reviewSubmitted) {
      await closeRecord(deps, current, "review-submitted", now);
      actions.push("closed:review-submitted", "archived");
    } else if (
      current.reviewWindowEndsAt &&
      parseInstant(now) >= parseInstant(current.reviewWindowEndsAt)
    ) {
      await closeRecord(deps, current, "review-window-expired", now);
      actions.push("closed:review-window-expired", "archived");
    }
  }

  const afterClose = await deps.lifecycle.get(tripId);
  if (!afterClose) return { tripId, from, to: from, actions, purge: null };
  let purge: PurgeResult | null = null;
  if (afterClose.state === "CLOSED") {
    if (!afterClose.archive) {
      await archiveIfNeeded(deps, afterClose, now);
      await deps.lifecycle.put(afterClose);
      actions.push("archived");
    }
    if (options.purgeEnabled) {
      purge = await executePurge(deps, tripId, now, { actor: options.actor });
      if (purge.ok && !purge.alreadyPurged) actions.push("purged");
    }
  }
  const final = await deps.lifecycle.get(tripId);
  return {
    tripId,
    from,
    to: final?.state ?? afterClose.state,
    actions,
    purge
  };
}

export interface SweepSummary {
  examined: number;
  ended: number;
  closed: number;
  purged: number;
  refusals: { tripId: string; code: string }[];
  errors: { tripId: string; message: string }[];
}

export async function runLifecycleSweep(
  deps: LifecycleDeps,
  now: UtcInstant,
  options: { purgeEnabled: boolean; actor?: string }
): Promise<SweepSummary> {
  const summary: SweepSummary = {
    examined: 0,
    ended: 0,
    closed: 0,
    purged: 0,
    refusals: [],
    errors: []
  };
  const records = await deps.lifecycle.listByStates([
    "ACTIVE",
    "TRIP_ENDED",
    "POST_TRIP_PENDING",
    "CLOSED"
  ]);
  for (const record of records) {
    summary.examined += 1;
    try {
      const result = await advanceLifecycle(deps, record.tripId, now, options);
      if (!result) continue;
      if (result.actions.includes("ended")) summary.ended += 1;
      if (result.actions.some((action) => action.startsWith("closed:")))
        summary.closed += 1;
      if (result.actions.includes("purged")) summary.purged += 1;
      if (result.purge && !result.purge.ok) {
        summary.refusals.push({ tripId: record.tripId, code: result.purge.code });
      }
    } catch (error) {
      // Fail-soft per trip (the post-trip-ask posture): one bad trip
      // never fails the run; it is named in the summary instead.
      summary.errors.push({
        tripId: record.tripId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Tombstone                                                           */
/* ------------------------------------------------------------------ */

export interface Tombstone {
  tripId: string;
  state: LifecycleStateName;
  purged: boolean;
  /** True once PURGED: devices must clear this trip's cached day
   *  data + live copies on next launch (design Phase 11). */
  clearOnDeviceCaches: boolean;
  acknowledgedAt: UtcInstant | null;
}

export async function getTombstone(
  deps: LifecycleDeps,
  tripId: string
): Promise<Tombstone | null> {
  const record = await deps.lifecycle.get(tripId);
  if (!record) return null;
  return {
    tripId,
    state: record.state,
    purged: record.state === "PURGED",
    clearOnDeviceCaches: record.state === "PURGED",
    acknowledgedAt: record.tombstoneAcknowledgedAt
  };
}

export async function acknowledgeTombstone(
  deps: LifecycleDeps,
  tripId: string,
  now: UtcInstant
): Promise<boolean> {
  const record = await deps.lifecycle.get(tripId);
  if (!record || record.state !== "PURGED") return false;
  if (!record.tombstoneAcknowledgedAt) {
    record.tombstoneAcknowledgedAt = now;
    record.history.push({ kind: "tombstone-ack", at: now });
    await deps.lifecycle.put(record);
  }
  return true;
}

/** The late-event guard: retries, shared links, and sync messages
 *  check this before touching a trip's live state. */
export async function isTripPurged(
  deps: LifecycleDeps,
  tripId: string
): Promise<boolean> {
  const record = await deps.lifecycle.get(tripId);
  return record?.state === "PURGED";
}

/** DTO view with the M5 receipt merged back in (M4 stores only the
 *  receipt's hash ref; the DTO carries the receipt itself). */
export async function loadLifecycleDTO(
  deps: LifecycleDeps,
  tripId: string
): Promise<LifecycleStateDTO | null> {
  const record = await deps.lifecycle.get(tripId);
  if (!record) return null;
  if (record.state === "PURGED" && !record.purgeReceipt) {
    record.purgeReceipt = await deps.receipts.getByTripRef(
      tripRefForTrip(tripId)
    );
  }
  const dto = toLifecycleDTO(record);
  const parsed = parseLifecycleStateDTO(dto);
  return parsed.ok ? dto : null;
}

/* ------------------------------------------------------------------ */
/* The tripFeedback trigger seam                                       */
/* ------------------------------------------------------------------ */

export interface FeedbackLifecycleResult {
  status: "closed" | "recorded" | "no-record" | "refused";
  code: string | null;
  state: LifecycleStateName | null;
}

/**
 * Called by tripFeedback's seam after a post-trip feedback save
 * (behind ROAMLY_BUILD2_LIFECYCLE_ENABLED): ensure the lifecycle
 * record exists (seeded from the trip row), record Phase 10's
 * ingest decision into the M4 history when one was produced, and
 * record the review submission — which closes + archives the trip.
 * Never throws at its callers: the seam wraps it fail-soft, like
 * Phase 10's.
 */
export async function recordFeedbackReviewSubmission(
  deps: LifecycleDeps,
  params: {
    tripId: string;
    decision: { eligible: boolean; ingested: boolean } | null;
    now: UtcInstant;
  }
): Promise<FeedbackLifecycleResult> {
  let record = await deps.lifecycle.get(params.tripId);
  if (!record) {
    const seed = await deps.data.getTripLifecycleSeed(params.tripId);
    if (!seed) return { status: "no-record", code: "TRIP_NOT_FOUND", state: null };
    const ensured = await ensureLifecycleRecord(deps, {
      ...seed,
      tripId: params.tripId,
      now: params.now
    });
    record = ensured.record;
  }
  if (params.decision) {
    await recordIngestDecision(deps, params.tripId, params.decision, params.now);
  }
  const result = await recordReviewSubmission(deps, params.tripId, params.now);
  if (!result.ok) {
    return {
      status: "refused",
      code: result.code,
      state: result.state
    };
  }
  return {
    status: result.state === "CLOSED" ? "closed" : "recorded",
    code: result.code,
    state: result.state
  };
}
