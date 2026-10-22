import { contentId } from "@/lib/roamly/engine/ids";
import { systemPackClock, toInstant, type PackClock } from "@/lib/roamly/engine/packs/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";
import {
  PLACES_DEFAULT_CAPS,
  PLACES_FREE_ALLOTMENT_PER_MONTH,
  PLACES_LIST_PRICES_USD_PER_1000,
  type PlacesCaps,
  type PlacesSku,
  type PlacesSkuCounts
} from "@/lib/roamly/engine/places/types";

/*
 * The Places cost guard — DB-shaped reserve/commit/release ledger
 * (DESIGN §2.5; CONTRACTS.md cost guard; owner condition "make sure
 * minimal expenses"). It replaces the shadow's JSON file ledger
 * (google-ledger.mjs) with the production shape:
 *
 *   - Monthly counters ride `roamly_admin_settings` (DATA-INFRA §5
 *     — no new table), one row per (scope, month) under the key
 *     placesLedgerSettingKey(). "Scope" is the Google
 *     project/billing identity, so no second code path can spend
 *     outside the same caps.
 *   - Every provider call is a reserve -> commit/release OPERATION
 *     keyed by a unique operation key, recorded against the
 *     candidate whose enrichment it serves (the operation key is
 *     stamped onto the enrichment record it produces).
 *   - reserve: the counter's committed+reserved must stay under
 *     the cap — a reservation that would cross is REFUSED (null)
 *     BEFORE any call is made, and the refusal is reported in the
 *     run's provenance. The candidate completes OSM-only.
 *   - commit: the call happened and is billable (a distance-gate
 *     REJECTION still commits its Text Search — the search ran).
 *   - release: the reservation was never spent (the call was
 *     provably never made) — the unit returns to the pool.
 *   - reconciliation: the call's outcome is UNKNOWN (timeout,
 *     transport failure). The unit STAYS counted against the cap
 *     (conservative: it may have been billed) and the operation is
 *     never blindly retried into a double-spend; a later manual or
 *     job-driven reconciliation settles it to commit or release.
 *
 * The interface is the boundary. InMemoryPlacesLedgerStore is the
 * reference implementation that defines and proves the semantics
 * (the Phase 3 pattern); the Supabase implementation maps
 * tryReserve onto ONE conditional UPDATE of the admin_settings row
 * (see the header of supabase/migrations/
 * 20261022_roamly_places_ledger.sql) and inherits these proofs.
 */

export interface PlacesSkuCounters {
  reserved: number;
  committed: number;
}

/** The `roamly_admin_settings.value` shape for one (scope, month). */
export interface PlacesLedgerCounters {
  version: 1;
  scope: string;
  month: string; // YYYY-MM (UTC, the shadow's monthKeyOf semantics)
  textSearch: PlacesSkuCounters;
  placeDetails: PlacesSkuCounters;
  updatedAt: UtcInstant | null;
}

export type PlacesOperationStatus = "reserved" | "committed" | "released" | "reconciliation";

export interface PlacesOperationRecord {
  operationKey: string;
  scope: string;
  month: string;
  sku: PlacesSku;
  packVersionId: string;
  candidateKey: string;
  status: PlacesOperationStatus;
  reservedAt: UtcInstant;
  settledAt: UtcInstant | null;
  note: string | null;
}

export interface PlacesReserveInput {
  scope: string;
  sku: PlacesSku;
  cap: number;
  packVersionId: string;
  candidateKey: string;
}

export interface PlacesLedgerStore {
  /** The month's counters (a zeroed row when none exists yet —
   *  reading never creates spend). */
  getCounters(scope: string, month: string): Promise<PlacesLedgerCounters>;
  /** Atomically count one reservation against the cap. Returns
   *  the operation record, or NULL when committed+reserved has
   *  reached the cap (the refusal — recorded by the CALLER in the
   *  run provenance; no provider call may follow a null). */
  tryReserve(input: PlacesReserveInput): Promise<PlacesOperationRecord | null>;
  commit(operationKey: string): Promise<PlacesOperationRecord>;
  release(operationKey: string, note: string): Promise<PlacesOperationRecord>;
  markReconciliation(operationKey: string, note: string): Promise<PlacesOperationRecord>;
  getOperation(operationKey: string): Promise<PlacesOperationRecord | null>;
  listOperations(scope: string, month: string): Promise<PlacesOperationRecord[]>;
}

/** The admin_settings key for one (scope, month) counter row. */
export function placesLedgerSettingKey(scope: string, month: string): string {
  return `places_ledger:v1:${scope}:${month}`;
}

/** UTC month key (YYYY-MM) — the shadow ledger's monthKeyOf. */
export function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Caps from the environment, the shadow's override discipline:
 *  ROAMLY_GOOGLE_DETAILS_CAP_MONTH / ROAMLY_GOOGLE_SEARCH_CAP_MONTH
 *  tighten (or, with eyes open, loosen) the CONTRACTS defaults. */
export function capsFromEnv(env: Record<string, string | undefined>): PlacesCaps {
  const d = parseInt(env.ROAMLY_GOOGLE_DETAILS_CAP_MONTH || "", 10);
  const s = parseInt(env.ROAMLY_GOOGLE_SEARCH_CAP_MONTH || "", 10);
  return {
    placeDetails: Number.isFinite(d) && d >= 0 ? d : PLACES_DEFAULT_CAPS.placeDetails,
    textSearch: Number.isFinite(s) && s >= 0 ? s : PLACES_DEFAULT_CAPS.textSearch
  };
}

const zeroCounters = (scope: string, month: string): PlacesLedgerCounters => ({
  version: 1,
  scope,
  month,
  textSearch: { reserved: 0, committed: 0 },
  placeDetails: { reserved: 0, committed: 0 },
  updatedAt: null
});

const clone = <T>(value: T): T => structuredClone(value);

export class PlacesLedgerError extends Error {
  readonly code: "OPERATION_NOT_FOUND" | "OPERATION_ALREADY_SETTLED";
  constructor(code: "OPERATION_NOT_FOUND" | "OPERATION_ALREADY_SETTLED", message: string) {
    super(message);
    this.name = "PlacesLedgerError";
    this.code = code;
  }
}

export class InMemoryPlacesLedgerStore implements PlacesLedgerStore {
  private readonly clock: PackClock;
  private readonly counters = new Map<string, PlacesLedgerCounters>();
  private readonly operations = new Map<string, PlacesOperationRecord>();
  private opSeq = 0;

  constructor(clock: PackClock = systemPackClock) {
    this.clock = clock;
  }

  private nowInstant(): UtcInstant {
    return toInstant(this.clock());
  }

  private rowFor(scope: string, month: string): PlacesLedgerCounters {
    const key = placesLedgerSettingKey(scope, month);
    let row = this.counters.get(key);
    if (!row) {
      row = zeroCounters(scope, month);
      this.counters.set(key, row);
    }
    return row;
  }

  async getCounters(scope: string, month: string): Promise<PlacesLedgerCounters> {
    const row = this.counters.get(placesLedgerSettingKey(scope, month));
    return clone(row ?? zeroCounters(scope, month));
  }

  async tryReserve(input: PlacesReserveInput): Promise<PlacesOperationRecord | null> {
    const month = monthKeyOf(this.clock());
    const row = this.rowFor(input.scope, month);
    const sku = row[input.sku];
    // The cap is evaluated on committed + outstanding reservations:
    // a unit already promised to an in-flight call is spoken for.
    if (sku.committed + sku.reserved >= input.cap) return null;
    sku.reserved += 1;
    row.updatedAt = this.nowInstant();
    this.opSeq += 1;
    const operation: PlacesOperationRecord = {
      operationKey: contentId("placesop", [input.scope, month, input.sku, input.packVersionId, input.candidateKey, this.opSeq]),
      scope: input.scope,
      month,
      sku: input.sku,
      packVersionId: input.packVersionId,
      candidateKey: input.candidateKey,
      status: "reserved",
      reservedAt: this.nowInstant(),
      settledAt: null,
      note: null
    };
    this.operations.set(operation.operationKey, operation);
    return clone(operation);
  }

  private settle(operationKey: string, to: "committed" | "released" | "reconciliation", note: string | null): PlacesOperationRecord {
    const op = this.operations.get(operationKey);
    if (!op) throw new PlacesLedgerError("OPERATION_NOT_FOUND", `no places operation ${operationKey}`);
    if (op.status === "committed" || op.status === "released") {
      throw new PlacesLedgerError("OPERATION_ALREADY_SETTLED", `places operation ${operationKey} is already ${op.status}`);
    }
    const row = this.rowFor(op.scope, op.month);
    const sku = row[op.sku];
    if (to === "committed") {
      sku.reserved -= 1;
      sku.committed += 1;
    } else if (to === "released") {
      sku.reserved -= 1;
    }
    // reconciliation: the unit STAYS in reserved (still counted) —
    // only its status changes, until a settle to commit/release.
    op.status = to;
    op.settledAt = to === "reconciliation" ? null : this.nowInstant();
    if (note) op.note = note;
    row.updatedAt = this.nowInstant();
    return clone(op);
  }

  async commit(operationKey: string): Promise<PlacesOperationRecord> {
    return this.settle(operationKey, "committed", null);
  }

  async release(operationKey: string, note: string): Promise<PlacesOperationRecord> {
    return this.settle(operationKey, "released", note);
  }

  async markReconciliation(operationKey: string, note: string): Promise<PlacesOperationRecord> {
    return this.settle(operationKey, "reconciliation", note);
  }

  async getOperation(operationKey: string): Promise<PlacesOperationRecord | null> {
    const op = this.operations.get(operationKey);
    return op ? clone(op) : null;
  }

  async listOperations(scope: string, month: string): Promise<PlacesOperationRecord[]> {
    return [...this.operations.values()].filter((o) => o.scope === scope && o.month === month).map((o) => clone(o));
  }
}

/* ------------------------------------------------------------------ */
/* Monthly cost accounting — the report the owner reads. Gross at     */
/* published list prices; net after the monthly free allotments.      */
/* Under the CONTRACTS caps a month nets $0 BY CONSTRUCTION (caps     */
/* sit inside the allotments) — the report proves it monthly rather   */
/* than assuming it.                                                  */
/* ------------------------------------------------------------------ */

export interface PlacesMonthlyCostReport {
  scope: string;
  month: string;
  committed: PlacesSkuCounts;
  reservedOutstanding: PlacesSkuCounts;
  caps: PlacesCaps;
  listPricesUsdPer1000: PlacesSkuCounts;
  freeAllotmentPerMonth: PlacesSkuCounts;
  grossUsd: number;
  billableUsd: number;
  note: string;
}

const usd2 = (n: number): number => +n.toFixed(2);

export function grossCostUsd(committed: PlacesSkuCounts): number {
  return usd2(
    (committed.textSearch * PLACES_LIST_PRICES_USD_PER_1000.textSearch +
      committed.placeDetails * PLACES_LIST_PRICES_USD_PER_1000.placeDetails) /
      1000
  );
}

export function monthlyCostReport(counters: PlacesLedgerCounters, caps: PlacesCaps): PlacesMonthlyCostReport {
  const committed: PlacesSkuCounts = { textSearch: counters.textSearch.committed, placeDetails: counters.placeDetails.committed };
  const billableUnits: PlacesSkuCounts = {
    textSearch: Math.max(0, committed.textSearch - PLACES_FREE_ALLOTMENT_PER_MONTH.textSearch),
    placeDetails: Math.max(0, committed.placeDetails - PLACES_FREE_ALLOTMENT_PER_MONTH.placeDetails)
  };
  return {
    scope: counters.scope,
    month: counters.month,
    committed,
    reservedOutstanding: { textSearch: counters.textSearch.reserved, placeDetails: counters.placeDetails.reserved },
    caps,
    listPricesUsdPer1000: { ...PLACES_LIST_PRICES_USD_PER_1000 },
    freeAllotmentPerMonth: { ...PLACES_FREE_ALLOTMENT_PER_MONTH },
    grossUsd: grossCostUsd(committed),
    billableUsd: grossCostUsd(billableUnits),
    note:
      "Gross is committed calls at published list prices; billable is what remains after the monthly free " +
      "allotments (Text Search Essentials 10,000; Place Details Pro 5,000). The CONTRACTS caps (9,000 / 4,500) " +
      "sit inside the allotments, so a guarded month bills $0 by construction."
  };
}
