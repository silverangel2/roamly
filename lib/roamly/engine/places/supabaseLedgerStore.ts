import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentId } from "@/lib/roamly/engine/ids";
import { systemPackClock, toInstant, type PackClock } from "@/lib/roamly/engine/packs/types";
import {
  PlacesLedgerError,
  monthKeyOf,
  placesLedgerSettingKey,
  type PlacesLedgerCounters,
  type PlacesLedgerStore,
  type PlacesOperationRecord,
  type PlacesReserveInput
} from "@/lib/roamly/engine/places/ledger";

/*
 * SupabasePlacesLedgerStore — the production PlacesLedgerStore,
 * landed with the 2026-10-22 production ship (SHIP-MANIFEST §4
 * step 4), over the storage shape the places-ledger migration
 * defines:
 *
 *   - Monthly counters ride `roamly_admin_settings`, one row per
 *     (scope, month) under placesLedgerSettingKey() — the migration
 *     seeds the current + next month for the production scope;
 *     later months are created on first use, exactly as the
 *     in-memory reference reads an absent row as zeroes.
 *   - Per-call operation records ride the same store, one row per
 *     operation under `places_ledger_op:v1:<operationKey>`, the
 *     record itself in the value (the audit trail the migration
 *     also stamps onto the candidate enrichment it paid for).
 *
 * The cap invariant is the money guard ("make sure minimal
 * expenses") and it is enforced by compare-and-swap: a reserve
 * reads the counter row, checks committed + reserved against the
 * cap on THAT read, and lands its increment only through an update
 * still conditioned on the row's previous updated_at. A concurrent
 * reserver moves updated_at, the loser's update matches zero rows,
 * and it re-reads and re-checks — the counter can never be pushed
 * past the cap by a race (the migration's "ONE conditional UPDATE"
 * discipline, expressed through PostgREST). Settles claim the
 * operation first (a status CAS on the operation row, so two
 * settles of the same operation cannot both move the counters),
 * then move the counters under the same CAS discipline.
 *
 * The client MUST be the service-role admin client: the settings
 * rows are system state. buildEngineRuntimeDeps enforces this.
 */

const SETTINGS_TABLE = "roamly_admin_settings";
const OPERATION_KEY_PREFIX = "places_ledger_op:v1:";
const CAS_ATTEMPTS = 10;

interface SettingsRow {
  key: string;
  value: unknown;
  updated_at: string;
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

function dbFailure(context: string, error: { message: string }): Error {
  return new Error(`SupabasePlacesLedgerStore ${context}: ${error.message}`);
}

function asCounters(value: unknown, scope: string, month: string): PlacesLedgerCounters {
  const base = zeroCounters(scope, month);
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<PlacesLedgerCounters>;
  const sku = (s: Partial<PlacesLedgerCounters>["textSearch"]): { reserved: number; committed: number } => ({
    reserved: typeof s?.reserved === "number" ? s.reserved : 0,
    committed: typeof s?.committed === "number" ? s.committed : 0
  });
  return {
    version: 1,
    scope,
    month,
    textSearch: sku(v.textSearch),
    placeDetails: sku(v.placeDetails),
    updatedAt: v.updatedAt ?? null
  };
}

export class SupabasePlacesLedgerStore implements PlacesLedgerStore {
  private readonly client: SupabaseClient;
  private readonly clock: PackClock;

  constructor(client: SupabaseClient, clock: PackClock = systemPackClock) {
    this.client = client;
    this.clock = clock;
  }

  private nowInstant(): string {
    return toInstant(this.clock());
  }

  private operationRowKey(operationKey: string): string {
    return `${OPERATION_KEY_PREFIX}${operationKey}`;
  }

  private async readSettingsRow(key: string): Promise<SettingsRow | null> {
    const { data, error } = await this.client
      .from(SETTINGS_TABLE)
      .select("key,value,updated_at")
      .eq("key", key)
      .maybeSingle();
    if (error) throw dbFailure(`read setting ${key}`, error);
    return (data as SettingsRow | null) ?? null;
  }

  /** Land a new value for a settings row, conditioned on the
   *  updated_at the caller read. Returns false when the row moved
   *  under us (the CAS lost — re-read and retry). */
  private async casSettingsValue(key: string, previousUpdatedAt: string, value: unknown): Promise<boolean> {
    const { data, error } = await this.client
      .from(SETTINGS_TABLE)
      .update({ value, updated_at: this.nowInstant() })
      .eq("key", key)
      .eq("updated_at", previousUpdatedAt)
      .select("key");
    if (error) throw dbFailure(`write setting ${key}`, error);
    return (((data as { key: string }[] | null) ?? []).length) > 0;
  }

  /** The counters row for (scope, month), creating the zeroed row
   *  on first use (an absent row reads as zeroes — creating it is
   *  not spend). */
  private async countersRow(scope: string, month: string): Promise<SettingsRow> {
    const key = placesLedgerSettingKey(scope, month);
    const existing = await this.readSettingsRow(key);
    if (existing) return existing;
    const { error } = await this.client
      .from(SETTINGS_TABLE)
      .upsert({ key, value: zeroCounters(scope, month) }, { onConflict: "key", ignoreDuplicates: true });
    if (error) throw dbFailure(`seed counters ${key}`, error);
    const created = await this.readSettingsRow(key);
    if (!created) throw dbFailure(`seed counters ${key}`, { message: "counter row absent after seed" });
    return created;
  }

  async getCounters(scope: string, month: string): Promise<PlacesLedgerCounters> {
    const row = await this.readSettingsRow(placesLedgerSettingKey(scope, month));
    return row ? asCounters(row.value, scope, month) : zeroCounters(scope, month);
  }

  async tryReserve(input: PlacesReserveInput): Promise<PlacesOperationRecord | null> {
    const month = monthKeyOf(this.clock());
    const key = placesLedgerSettingKey(input.scope, month);
    await this.countersRow(input.scope, month);
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const row = await this.readSettingsRow(key);
      if (!row) throw dbFailure("reserve", { message: `counter row ${key} absent` });
      const counters = asCounters(row.value, input.scope, month);
      const sku = counters[input.sku];
      // The cap is evaluated on committed + outstanding reservations
      // from the SAME read the CAS conditions on: a unit already
      // promised to an in-flight call is spoken for.
      if (sku.committed + sku.reserved >= input.cap) return null;
      const next: PlacesLedgerCounters = {
        ...counters,
        [input.sku]: { reserved: sku.reserved + 1, committed: sku.committed },
        updatedAt: this.nowInstant() as PlacesLedgerCounters["updatedAt"]
      };
      if (!(await this.casSettingsValue(key, row.updated_at, next))) continue;
      const operation: PlacesOperationRecord = {
        operationKey: contentId("placesop", [
          input.scope,
          month,
          input.sku,
          input.packVersionId,
          input.candidateKey,
          randomUUID()
        ]),
        scope: input.scope,
        month,
        sku: input.sku,
        packVersionId: input.packVersionId,
        candidateKey: input.candidateKey,
        status: "reserved",
        reservedAt: this.nowInstant() as PlacesOperationRecord["reservedAt"],
        settledAt: null,
        note: null
      };
      const { error } = await this.client
        .from(SETTINGS_TABLE)
        .insert({ key: this.operationRowKey(operation.operationKey), value: operation });
      if (error) throw dbFailure("record places operation", error);
      return clone(operation);
    }
    throw dbFailure("reserve", { message: `counter row ${key} stayed contended through ${CAS_ATTEMPTS} attempts` });
  }

  private async settle(
    operationKey: string,
    to: "committed" | "released" | "reconciliation",
    note: string | null
  ): Promise<PlacesOperationRecord> {
    const rowKey = this.operationRowKey(operationKey);
    const row = await this.readSettingsRow(rowKey);
    if (!row) throw new PlacesLedgerError("OPERATION_NOT_FOUND", `no places operation ${operationKey}`);
    const op = row.value as PlacesOperationRecord;
    if (op.status === "committed" || op.status === "released") {
      throw new PlacesLedgerError("OPERATION_ALREADY_SETTLED", `places operation ${operationKey} is already ${op.status}`);
    }
    const settled: PlacesOperationRecord = {
      ...op,
      status: to,
      settledAt: to === "reconciliation" ? null : (this.nowInstant() as PlacesOperationRecord["settledAt"]),
      note: note ? note : op.note
    };
    // Claim the settle first (status CAS): the loser of a double
    // settle is refused BEFORE any counter moves.
    if (!(await this.casSettingsValue(rowKey, row.updated_at, settled))) {
      const fresh = await this.readSettingsRow(rowKey);
      const freshOp = fresh ? (fresh.value as PlacesOperationRecord) : null;
      if (freshOp && (freshOp.status === "committed" || freshOp.status === "released")) {
        throw new PlacesLedgerError(
          "OPERATION_ALREADY_SETTLED",
          `places operation ${operationKey} is already ${freshOp.status}`
        );
      }
      throw dbFailure("settle places operation", { message: `operation row ${operationKey} stayed contended` });
    }
    if (to !== "reconciliation") {
      const key = placesLedgerSettingKey(op.scope, op.month);
      await this.countersRow(op.scope, op.month);
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
        const counterRow = await this.readSettingsRow(key);
        if (!counterRow) throw dbFailure("settle counters", { message: `counter row ${key} absent` });
        const counters = asCounters(counterRow.value, op.scope, op.month);
        const sku = counters[op.sku];
        const next: PlacesLedgerCounters = {
          ...counters,
          [op.sku]:
            to === "committed"
              ? { reserved: sku.reserved - 1, committed: sku.committed + 1 }
              : { reserved: sku.reserved - 1, committed: sku.committed },
          updatedAt: this.nowInstant() as PlacesLedgerCounters["updatedAt"]
        };
        if (await this.casSettingsValue(key, counterRow.updated_at, next)) return clone(settled);
      }
      throw dbFailure("settle counters", { message: `counter row ${key} stayed contended through ${CAS_ATTEMPTS} attempts` });
    }
    // reconciliation: the unit STAYS in reserved (still counted) —
    // only the operation's status changed, until a later settle.
    return clone(settled);
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
    const row = await this.readSettingsRow(this.operationRowKey(operationKey));
    return row ? clone(row.value as PlacesOperationRecord) : null;
  }

  async listOperations(scope: string, month: string): Promise<PlacesOperationRecord[]> {
    const { data, error } = await this.client
      .from(SETTINGS_TABLE)
      .select("key,value,updated_at")
      .like("key", `${OPERATION_KEY_PREFIX}%`);
    if (error) throw dbFailure("list places operations", error);
    return (((data as SettingsRow[] | null) ?? [])
      .map((row) => row.value as PlacesOperationRecord)
      .filter((op) => op && op.scope === scope && op.month === month)
      .sort((a, b) => (a.reservedAt < b.reservedAt ? -1 : 1))
      .map((op) => clone(op)));
  }
}
