/*
 * Build 2 Live Companion — the append-only interaction ledger
 * (DESIGN-PRODUCTION.md Phase 7, migration M2; contradiction C6:
 * today's activity statuses are destructive overwrites — this ledger
 * is the additive trail behind them: every Directions-view, check-in
 * (+ Undo), skip, and missed is a row with dwell + provenance).
 *
 * Append-only is structural, not a promise:
 *  - the store seam exposes append + list ONLY (no update, no
 *    delete);
 *  - rows carry the Phase 1 content ID (ids.companionLedgerEntryId),
 *    so re-appending the same action (offline re-flush, double tap)
 *    is an idempotent no-op, never a duplicate;
 *  - Undo is a NEW row carrying the undone row's classification and
 *    undoOfEntryId pointing at it — the Phase 1 vocabulary has no
 *    UNDO classification, so the marker borrows its target's; the
 *    view fold (companionPanel.annulledEntryIds) annuls the target
 *    and ignores the marker. History is never erased;
 *  - M2 enforces the same shape in the database (insert/select
 *    grants only, plus a trigger that refuses UPDATE/DELETE).
 *
 * Stale/expiry are NOT written here: they are derived view state
 * (companionPanel.evaluateItemLifecycle). The STALE/EXPIRED
 * classifications exist in the Phase 1 vocabulary for the Phase 10
 * as-lived snapshot and Phase 11 accounting, not for live writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { companionLedgerEntryId } from "./engine/ids";
import { instantStringToLocal, type UtcInstant } from "./engine/time";
import {
  parseCompanionLedgerEntryDTO,
  type CompanionLedgerEntryDTO,
  type LedgerClassification,
  type ProvenanceDTO
} from "./engine/types";
import { undoTargetForEntries } from "./companionPanel";

export const COMPANION_LEDGER_TABLE = "roamly_companion_ledger";

export interface CompanionLedgerStore {
  append(entry: CompanionLedgerEntryDTO): Promise<{ inserted: boolean }>;
  listForTrip(tripId: string): Promise<CompanionLedgerEntryDTO[]>;
}

interface LedgerRow {
  entry_id: string;
  trip_id: string;
  activity_ref: string;
  classification: LedgerClassification;
  at: string;
  at_minute_of_trip: number;
  dwell_minutes: number | null;
  undo_of_entry_id: string | null;
  provenance: ProvenanceDTO;
}

function rowFromDTO(entry: CompanionLedgerEntryDTO): LedgerRow {
  return {
    entry_id: entry.entryId,
    trip_id: entry.tripId,
    activity_ref: entry.activityRef,
    classification: entry.classification,
    at: entry.at,
    at_minute_of_trip: entry.atMinuteOfTrip,
    dwell_minutes: entry.dwellMinutes,
    undo_of_entry_id: entry.undoOfEntryId,
    provenance: entry.provenance
  };
}

function dtoFromRow(row: LedgerRow): CompanionLedgerEntryDTO {
  return {
    entryId: row.entry_id,
    tripId: row.trip_id,
    activityRef: row.activity_ref,
    classification: row.classification,
    at: row.at,
    atMinuteOfTrip: row.at_minute_of_trip,
    dwellMinutes: row.dwell_minutes,
    undoOfEntryId: row.undo_of_entry_id,
    provenance: row.provenance
  };
}

export function isMissingLedgerTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      /relation .* does not exist/i.test(candidate.message))
  );
}

export class SupabaseCompanionLedgerStore implements CompanionLedgerStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async append(entry: CompanionLedgerEntryDTO): Promise<{ inserted: boolean }> {
    const { data, error } = await this.supabase
      .from(COMPANION_LEDGER_TABLE)
      .upsert(rowFromDTO(entry), { onConflict: "entry_id", ignoreDuplicates: true })
      .select("entry_id");
    if (error) throw error;
    return { inserted: Array.isArray(data) && data.length > 0 };
  }

  async listForTrip(tripId: string): Promise<CompanionLedgerEntryDTO[]> {
    const { data, error } = await this.supabase
      .from(COMPANION_LEDGER_TABLE)
      .select(
        "entry_id, trip_id, activity_ref, classification, at, at_minute_of_trip, dwell_minutes, undo_of_entry_id, provenance"
      )
      .eq("trip_id", tripId)
      .order("at_minute_of_trip", { ascending: true })
      .order("at", { ascending: true });
    if (error) {
      // A missing M2 table reads as an empty ledger (the gateService
      // posture): the panel renders from production status alone and
      // the first applied migration turns the trail on.
      if (isMissingLedgerTableError(error)) return [];
      throw error;
    }
    return (data || []).map((row) => dtoFromRow(row as LedgerRow));
  }
}

export class InMemoryCompanionLedgerStore implements CompanionLedgerStore {
  private readonly rows = new Map<string, CompanionLedgerEntryDTO>();

  async append(entry: CompanionLedgerEntryDTO): Promise<{ inserted: boolean }> {
    if (this.rows.has(entry.entryId)) return { inserted: false };
    this.rows.set(entry.entryId, entry);
    return { inserted: true };
  }

  async listForTrip(tripId: string): Promise<CompanionLedgerEntryDTO[]> {
    return [...this.rows.values()]
      .filter((entry) => entry.tripId === tripId)
      .sort(
        (a, b) =>
          a.atMinuteOfTrip - b.atMinuteOfTrip || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)
      );
  }
}

/* ------------------------------------------------------------------ */
/* Append service                                                      */
/* ------------------------------------------------------------------ */

export interface LedgerAppendResult {
  ok: boolean;
  inserted: boolean;
  entry: CompanionLedgerEntryDTO | null;
  /** True when the failure is "M2 not applied yet" — the caller's
   *  action still succeeded; only the trail is not recording. */
  unavailable: boolean;
  error: string | null;
}

/** Build the Phase 1 DTO for one ledger action. Pure — shared by the
 *  server service and the client panel's optimistic entries, so both
 *  sides mint identical rows (same content ID). */
export function buildLedgerEntryDTO(params: {
  tripId: string;
  activityRef: string;
  classification: LedgerClassification;
  at: UtcInstant;
  timezone: string;
  provenance: ProvenanceDTO;
  dwellMinutes?: number | null;
  undoOfEntryId?: string | null;
}): CompanionLedgerEntryDTO {
  const parts = instantStringToLocal(params.at, params.timezone);
  return {
    entryId: companionLedgerEntryId({
      tripId: params.tripId,
      activityRef: params.activityRef,
      classification: params.classification,
      atMinuteOfTrip: parts.minutes
    }),
    tripId: params.tripId,
    activityRef: params.activityRef,
    classification: params.classification,
    at: params.at,
    atMinuteOfTrip: parts.minutes,
    dwellMinutes: params.dwellMinutes ?? null,
    undoOfEntryId: params.undoOfEntryId ?? null,
    provenance: params.provenance
  };
}

export async function appendCompanionLedgerAction(
  store: CompanionLedgerStore,
  params: {
    tripId: string;
    activityRef: string;
    classification: LedgerClassification;
    at: UtcInstant;
    timezone: string;
    provenance: ProvenanceDTO;
    dwellMinutes?: number | null;
    undoOfEntryId?: string | null;
  }
): Promise<LedgerAppendResult> {
  const entry = buildLedgerEntryDTO(params);
  const parsed = parseCompanionLedgerEntryDTO(entry);
  if (!parsed.ok) {
    return {
      ok: false,
      inserted: false,
      entry: null,
      unavailable: false,
      error: parsed.errors.join("; ")
    };
  }
  try {
    const { inserted } = await store.append(parsed.value);
    return { ok: true, inserted, entry: parsed.value, unavailable: false, error: null };
  } catch (error) {
    return {
      ok: false,
      inserted: false,
      entry: null,
      unavailable: isMissingLedgerTableError(error),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Undo = an append-only annulment marker against the item's current
 *  undo target. Nothing to undo is a plain refusal, not an error. */
export async function appendCompanionLedgerUndo(
  store: CompanionLedgerStore,
  params: {
    tripId: string;
    activityRef: string;
    at: UtcInstant;
    timezone: string;
    provenance: ProvenanceDTO;
  }
): Promise<LedgerAppendResult> {
  let entries: CompanionLedgerEntryDTO[];
  try {
    entries = await store.listForTrip(params.tripId);
  } catch (error) {
    return {
      ok: false,
      inserted: false,
      entry: null,
      unavailable: isMissingLedgerTableError(error),
      error: error instanceof Error ? error.message : String(error)
    };
  }
  const target = undoTargetForEntries(entries, params.activityRef);
  if (!target) {
    return {
      ok: false,
      inserted: false,
      entry: null,
      unavailable: false,
      error: "nothing to undo"
    };
  }
  return appendCompanionLedgerAction(store, {
    tripId: params.tripId,
    activityRef: params.activityRef,
    classification: target.classification,
    at: params.at,
    timezone: params.timezone,
    provenance: params.provenance,
    undoOfEntryId: target.entryId
  });
}

/** Panel-action provenance: the traveler's own tap, labeled for the
 *  on-tap provenance line (BUILD2-SPEC addition D). */
export function panelActionProvenance(at: UtcInstant): ProvenanceDTO {
  return {
    source: "traveler",
    sourceRef: null,
    recordedAt: at,
    label: "live companion panel"
  };
}
