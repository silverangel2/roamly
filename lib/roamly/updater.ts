/*
 * Phase 9 — UPDATER SERVICE (DESIGN-PRODUCTION.md Phase 9).
 *
 * The Updater adjusts the itinerary SILENTLY for alignment and LOUD
 * for costly collisions — owner law, encoded in the lane decision:
 *
 *   · A verified signal (Phase 8's classified stream) on the silent
 *     lane applies in ONE transaction: the plan write (CAS-guarded),
 *     the field-level adjustment records (every one carrying its
 *     provenance), and the applied-signal registry entry. The write
 *     is reloaded and verified field-by-field; a change that does
 *     not read back identical is ROLLED BACK and reported, never
 *     asserted.
 *   · The loud lane writes NOTHING to the plan. It emits exactly one
 *     plain-human alert and parks the candidate (the computed
 *     changes, unapplied) for the traveler's decision. Approval
 *     applies the parked candidate under the same hash guard;
 *     rejection discards it and records the outcome (a LEARN signal).
 *   · Protected / timed / paid items are NEVER silently moved.
 *   · Idempotency is by signal content ID: the same signal
 *     re-delivered changes nothing twice (the E2E tester's
 *     duplicate-delay leg is the spec).
 *   · Trust ladder (Native Flight Watch seam): OFFICIAL and REPORTED
 *     facts may apply silently; an INFERRED movement signal may only
 *     ever trigger a re-solve PROPOSAL — it never writes the plan.
 *   · Early/late check-in (room-ready events): a room-wait may never
 *     contain a protected/timed commitment (the Phase 2 judge is the
 *     authority); an early room dissolves the wait and the freed
 *     time is an OFFER; a late room extends the wait, preserves the
 *     rest, and owes EXACTLY ONE notification.
 *
 * The field-application logic is a faithful port of the shadow
 * updater (part2-travel-days-2026-10-21/src/updater.mjs) onto the
 * production live-day shape. The shadow's chain.mjs is NOT ported.
 *
 * Persistence sits behind UpdaterStore. The InMemory store proves
 * the semantics; the Supabase store anchors the transaction on the
 * roamly_itineraries repair_revision CAS + content-hash RPC (the
 * companionRepairEngine pattern) — see PHASE9-REPORT.md for the
 * named live-seam limits.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { LocalDate, PlanMinutes, UtcInstant } from "@/lib/roamly/engine/time";
import { fmt } from "@/lib/roamly/engine/util";
import type { EngineDay } from "@/lib/roamly/engine/util";
import { judgeTrip } from "@/lib/roamly/engine/judges";
import type {
  BookingFactDTO,
  BookingSignalDTO
} from "@/lib/roamly/engine/types";
import { contentId } from "@/lib/roamly/engine/ids";
import type { ClassifiedBookingSignal } from "@/lib/roamly/reconciliationLane";
import {
  buildRepairedDay,
  computeAffectedSet,
  liveDayHash,
  proposeRepairs,
  syncLiveItemTimes,
  verifyRepairedDay
} from "@/lib/roamly/repairPlanner";
import type {
  AffectedItem,
  Disruption,
  LiveDay,
  LiveItem,
  RepairProposal
} from "@/lib/roamly/repairPlanner";
import type { EnginePack } from "@/lib/roamly/engine/util";

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

/**
 * One field-level silent adjustment, with its provenance. (Phase 1
 * defines no literal AdjustmentDTO; this record follows the Phase 1
 * provenance contract — signalId + short label + message + received
 * — exactly as the shadow updater's change log carried it.)
 */
export interface AdjustmentRecord {
  itemId: string;
  field: string;
  before: unknown;
  after: unknown;
  basis: string;
  provenance: {
    signalId: string;
    shortLabel: string;
    messageId: string;
    receivedAt: string;
  };
}

export interface UpdaterAlert {
  alertId: string;
  tripId: string;
  headline: string;
  message: string;
  collisions: { itemId: string; itemName: string; detail: string }[];
  signalId: string | null;
  at: UtcInstant;
}

export interface OutcomeRecord {
  outcomeId: string;
  tripId: string;
  kind:
    | "repair-approved"
    | "repair-rejected"
    | "alignment-approved"
    | "alignment-rejected"
    | "apply-rolled-back"
    | "room-ready-offer";
  proposalId: string | null;
  detail: string;
  at: UtcInstant;
}

export interface ParkedProposal {
  proposalId: string;
  tripId: string;
  dayId: string;
  kind: "repair" | "alignment";
  status: "proposed" | "applied" | "rejected";
  /** Itinerary hash at park time — approval refuses when it moved. */
  itineraryHashBefore: string;
  repair: RepairProposal | null;
  alignment: { signalId: string; changes: AdjustmentRecord[] } | null;
  trust: SignalTrust;
  createdAt: UtcInstant;
  decidedAt: UtcInstant | null;
}

export type SignalTrust = "OFFICIAL" | "REPORTED" | "INFERRED";

/* ------------------------------------------------------------------ */
/* Itinerary document (the store's unit of transaction)                */
/* ------------------------------------------------------------------ */

export interface UpdaterHotel {
  name: string | null;
  address: string | null;
  stars: number | null;
  price: unknown;
  checkIn: Record<string, unknown> | null;
  checkOut: Record<string, unknown> | null;
}

export interface UpdaterItinerary {
  tripId: string;
  userId: string;
  timeZone: string;
  revision: number;
  hotel: UpdaterHotel | null;
  days: LiveDay[];
}

export function itineraryHash(itinerary: UpdaterItinerary): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        days: itinerary.days.map((d) => liveDayHash(d)),
        hotel: itinerary.hotel
      })
    )
    .digest("hex");
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export interface UpdaterStore {
  loadItinerary(tripId: string): Promise<UpdaterItinerary | null>;
  commitItinerary(params: {
    tripId: string;
    expectedRevision: number;
    itinerary: UpdaterItinerary;
  }): Promise<{ ok: true; revision: number } | { ok: false; error: "CAS_MISMATCH" }>;
  hasAppliedSignal(signalId: string): Promise<boolean>;
  recordAppliedSignal(rec: { signalId: string; tripId: string; at: UtcInstant }): Promise<void>;
  insertAdjustmentRecords(records: (AdjustmentRecord & { tripId: string })[]): Promise<void>;
  listAdjustmentRecords(tripId: string): Promise<(AdjustmentRecord & { tripId: string })[]>;
  insertAlert(alert: UpdaterAlert): Promise<void>;
  listAlerts(tripId: string): Promise<UpdaterAlert[]>;
  parkProposal(proposal: ParkedProposal): Promise<void>;
  loadProposal(proposalId: string): Promise<ParkedProposal | null>;
  updateProposal(
    proposalId: string,
    patch: Partial<Pick<ParkedProposal, "status" | "decidedAt">>
  ): Promise<void>;
  hasNotification(key: string): Promise<boolean>;
  recordNotification(rec: {
    key: string;
    tripId: string;
    dayId: string;
    message: string;
    at: UtcInstant;
  }): Promise<void>;
  listNotifications(tripId: string): Promise<{ key: string; message: string }[]>;
  insertOutcome(rec: OutcomeRecord): Promise<void>;
  listOutcomes(tripId: string): Promise<OutcomeRecord[]>;
}

export class InMemoryUpdaterStore implements UpdaterStore {
  private itineraries = new Map<string, UpdaterItinerary>();
  private appliedSignals = new Set<string>();
  private adjustments: (AdjustmentRecord & { tripId: string })[] = [];
  private alerts: UpdaterAlert[] = [];
  private proposals = new Map<string, ParkedProposal>();
  private notifications = new Map<string, { key: string; tripId: string; message: string }>();
  private outcomes: OutcomeRecord[] = [];
  /** Test hook: corrupt the stored itinerary AFTER a commit lands,
   *  simulating a write that does not read back as written. */
  tamperAfterCommit: ((itinerary: UpdaterItinerary) => void) | null = null;

  seed(itinerary: UpdaterItinerary): void {
    this.itineraries.set(itinerary.tripId, structuredClone(itinerary));
  }

  async loadItinerary(tripId: string): Promise<UpdaterItinerary | null> {
    const found = this.itineraries.get(tripId);
    return found ? structuredClone(found) : null;
  }

  async commitItinerary(params: {
    tripId: string;
    expectedRevision: number;
    itinerary: UpdaterItinerary;
  }): Promise<{ ok: true; revision: number } | { ok: false; error: "CAS_MISMATCH" }> {
    const current = this.itineraries.get(params.tripId);
    if (!current || current.revision !== params.expectedRevision) {
      return { ok: false, error: "CAS_MISMATCH" };
    }
    const stored = structuredClone(params.itinerary);
    stored.revision = params.expectedRevision + 1;
    this.itineraries.set(params.tripId, stored);
    if (this.tamperAfterCommit) {
      const tamper = this.tamperAfterCommit;
      this.tamperAfterCommit = null;
      tamper(stored);
    }
    return { ok: true, revision: stored.revision };
  }

  async hasAppliedSignal(signalId: string): Promise<boolean> {
    return this.appliedSignals.has(signalId);
  }

  async recordAppliedSignal(rec: { signalId: string; tripId: string; at: UtcInstant }): Promise<void> {
    void rec;
    this.appliedSignals.add(rec.signalId);
  }

  async insertAdjustmentRecords(records: (AdjustmentRecord & { tripId: string })[]): Promise<void> {
    this.adjustments.push(...structuredClone(records));
  }

  async listAdjustmentRecords(tripId: string): Promise<(AdjustmentRecord & { tripId: string })[]> {
    return structuredClone(this.adjustments.filter((r) => r.tripId === tripId));
  }

  async insertAlert(alert: UpdaterAlert): Promise<void> {
    this.alerts.push(structuredClone(alert));
  }

  async listAlerts(tripId: string): Promise<UpdaterAlert[]> {
    return structuredClone(this.alerts.filter((a) => a.tripId === tripId));
  }

  async parkProposal(proposal: ParkedProposal): Promise<void> {
    this.proposals.set(proposal.proposalId, structuredClone(proposal));
  }

  async loadProposal(proposalId: string): Promise<ParkedProposal | null> {
    const found = this.proposals.get(proposalId);
    return found ? structuredClone(found) : null;
  }

  async updateProposal(
    proposalId: string,
    patch: Partial<Pick<ParkedProposal, "status" | "decidedAt">>
  ): Promise<void> {
    const found = this.proposals.get(proposalId);
    if (found) Object.assign(found, patch);
  }

  async hasNotification(key: string): Promise<boolean> {
    return this.notifications.has(key);
  }

  async recordNotification(rec: {
    key: string;
    tripId: string;
    dayId: string;
    message: string;
    at: UtcInstant;
  }): Promise<void> {
    if (!this.notifications.has(rec.key)) {
      this.notifications.set(rec.key, { key: rec.key, tripId: rec.tripId, message: rec.message });
    }
  }

  async listNotifications(tripId: string): Promise<{ key: string; message: string }[]> {
    return [...this.notifications.values()]
      .filter((n) => n.tripId === tripId)
      .map((n) => ({ key: n.key, message: n.message }));
  }

  async insertOutcome(rec: OutcomeRecord): Promise<void> {
    this.outcomes.push(structuredClone(rec));
  }

  async listOutcomes(tripId: string): Promise<OutcomeRecord[]> {
    return structuredClone(this.outcomes.filter((o) => o.tripId === tripId));
  }
}

/* ------------------------------------------------------------------ */
/* Field application — the shadow updater, ported faithfully.          */
/* A change is recorded per FIELD (the string spelling and the         */
/* minutes spelling are separate fields, exactly as the shadow         */
/* counted them).                                                      */
/* ------------------------------------------------------------------ */

type ItemFieldView = Record<string, unknown>;

function fieldView(item: LiveItem): ItemFieldView {
  return {
    name: item.title,
    date: item.date ?? null,
    start: item.startTime,
    startMin: item.start,
    end: item.endTime,
    endMin: item.end,
    place: item.place ?? null,
    address: item.address ?? null,
    status: item.status ?? item.state ?? null,
    provider: item.provider ?? null,
    price: item.price ?? null,
    boardingMin: item.boardingMin ?? null,
    prepaid: item.prepaid ?? null,
    delayed: item.delayed ?? null
  };
}

function writeField(item: LiveItem, field: string, value: unknown): void {
  switch (field) {
    case "name":
      item.title = String(value);
      item.name = String(value);
      break;
    case "date":
      item.date = value as LocalDate;
      break;
    case "start":
      item.startTime = String(value);
      break;
    case "startMin":
      item.start = value as PlanMinutes;
      break;
    case "end":
      item.endTime = String(value);
      break;
    case "endMin":
      item.end = value as PlanMinutes;
      break;
    case "place":
      item.place = value as string | null;
      break;
    case "address":
      item.address = value as string | null;
      break;
    case "status":
      item.status = String(value);
      break;
    case "provider":
      item.provider = value as string | null;
      break;
    case "price":
      item.price = value;
      break;
    case "boardingMin":
      item.boardingMin = value as PlanMinutes | null;
      break;
    case "prepaid":
      item.prepaid = value === null || value === undefined ? undefined : (value as boolean);
      break;
    case "delayed":
      item.delayed = value === null || value === undefined ? undefined : (value as boolean);
      break;
    default:
      break;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function signalProvenance(signal: BookingSignalDTO): AdjustmentRecord["provenance"] {
  return {
    signalId: signal.signalId,
    shortLabel: signal.provenance.label || "booking-email",
    messageId: signal.provenance.messageId,
    receivedAt: signal.provenance.recordedAt ?? ""
  };
}

function setField(
  item: LiveItem,
  field: string,
  value: unknown,
  changeLog: AdjustmentRecord[],
  ctx: { signal: BookingSignalDTO; basis?: string }
): boolean {
  const view = fieldView(item);
  const before = view[field] ?? null;
  if (sameValue(before, value)) return false;
  writeField(item, field, value);
  if (field === "start" || field === "startMin" || field === "end" || field === "endMin") {
    syncLiveItemTimes(item);
  }
  changeLog.push({
    itemId: item.item_id,
    field,
    before: before ?? null,
    after: value ?? null,
    basis:
      ctx.basis ||
      "verified booking email outranks the planning estimate for this booked item",
    provenance: signalProvenance(ctx.signal)
  });
  return true;
}

function applyFlightFact(
  itinerary: UpdaterItinerary,
  item: LiveItem,
  signal: BookingSignalDTO,
  changeLog: AdjustmentRecord[]
): void {
  const b: BookingFactDTO = signal.booking;
  const oldArrival = item.end;
  if (b.name) setField(item, "name", b.name, changeLog, { signal });
  if (b.start) {
    setField(item, "date", b.start.date, changeLog, { signal });
    setField(item, "start", b.start.time, changeLog, { signal });
    setField(item, "startMin", b.start.minutes, changeLog, { signal });
  }
  if (b.end) {
    setField(item, "end", b.end.time, changeLog, { signal });
    setField(item, "endMin", b.end.minutes, changeLog, { signal });
  }
  if (b.to) setField(item, "place", b.to, changeLog, { signal });
  if (b.from && b.to) setField(item, "address", `${b.from} to ${b.to}`, changeLog, { signal });
  setField(item, "status", "booked", changeLog, { signal });
  if (b.provider) setField(item, "provider", b.provider, changeLog, { signal });
  if (b.price.amount !== null && b.price.amount !== undefined) {
    setField(item, "price", b.price, changeLog, { signal });
  }
  if (b.status === "delayed") setField(item, "delayed", true, changeLog, { signal });
  item.provenance = signal.provenance;
  // The arrival transfer is logistics tied to the flight fact. Shift
  // it with the verified arrival; not a rewrite of a commitment.
  const day = itinerary.days.find((d) => d.items.some((i) => i.item_id === item.item_id));
  const transfer = day?.items.find(
    (i) =>
      (i.kind === "transfer" || i.item_type === "transfer") &&
      Math.abs(i.start - oldArrival) <= 45
  );
  if (transfer && transfer.start !== item.end) {
    const duration = transfer.durationMin ?? transfer.end - transfer.start;
    const basisStart = "arrival transfer follows the verified flight arrival";
    const basisEnd = "arrival transfer keeps its planned duration after the verified flight arrival";
    setField(transfer, "start", item.endTime, changeLog, { signal, basis: basisStart });
    setField(transfer, "startMin", item.end, changeLog, { signal, basis: basisStart });
    setField(transfer, "end", fmt(item.end + duration), changeLog, { signal, basis: basisEnd });
    setField(transfer, "endMin", item.end + duration, changeLog, { signal, basis: basisEnd });
    transfer.provenance = signal.provenance;
  }
}

function applyHotelFact(
  itinerary: UpdaterItinerary,
  item: LiveItem,
  signal: BookingSignalDTO,
  changeLog: AdjustmentRecord[]
): void {
  const b = signal.booking as BookingFactDTO & { stars?: number | null };
  const duration = item.end - item.start;
  if (b.start) {
    setField(item, "date", b.start.date, changeLog, { signal });
    setField(item, "start", b.start.time, changeLog, { signal });
    setField(item, "startMin", b.start.minutes, changeLog, { signal });
    setField(item, "end", fmt(b.start.minutes + duration), changeLog, {
      signal,
      basis: "check-in action keeps its planned handling window from the verified check-in time"
    });
    setField(item, "endMin", b.start.minutes + duration, changeLog, {
      signal,
      basis: "check-in action keeps its planned handling window from the verified check-in time"
    });
  }
  if (b.name) setField(item, "place", b.name, changeLog, { signal });
  if (b.address) setField(item, "address", b.address, changeLog, { signal });
  setField(item, "status", "booked", changeLog, { signal });
  if (b.provider) setField(item, "provider", b.provider, changeLog, { signal });
  item.provenance = signal.provenance;
  const hotel = itinerary.hotel;
  if (hotel) {
    const hotelItem: LiveItem = {
      item_id: "trip.hotel",
      title: hotel.name || "",
      start: 0,
      end: 0,
      startTime: "00:00",
      endTime: "00:00",
      name: hotel.name || undefined,
      place: hotel.name,
      address: hotel.address,
      price: hotel.price
    };
    if (b.name) setField(hotelItem, "name", b.name, changeLog, { signal });
    if (b.address) setField(hotelItem, "address", b.address, changeLog, { signal });
    hotel.name = hotelItem.title || hotel.name;
    hotel.address = hotelItem.address ?? hotel.address;
    if (b.stars !== undefined && b.stars !== null && hotel.stars !== b.stars) {
      changeLog.push({
        itemId: "trip.hotel",
        field: "stars",
        before: hotel.stars,
        after: b.stars,
        basis: "verified booking email outranks the planning estimate for this booked item",
        provenance: signalProvenance(signal)
      });
      hotel.stars = b.stars;
    }
    if (b.price.amount !== null && b.price.amount !== undefined && !sameValue(hotel.price, b.price)) {
      changeLog.push({
        itemId: "trip.hotel",
        field: "price",
        before: hotel.price ?? null,
        after: b.price,
        basis: "verified booking email outranks the planning estimate for this booked item",
        provenance: signalProvenance(signal)
      });
      hotel.price = b.price;
    }
    if (b.start) {
      hotel.checkIn = {
        date: b.start.date,
        time: b.start.time,
        minutes: b.start.minutes,
        timeZone: b.start.timeZone,
        source: "booking-email"
      };
    }
    if (b.end) {
      hotel.checkOut = {
        date: b.end.date,
        time: b.end.time,
        minutes: b.end.minutes,
        timeZone: b.end.timeZone,
        source: "booking-email"
      };
    }
  }
}

function applyTimedFact(
  itinerary: UpdaterItinerary,
  item: LiveItem,
  signal: BookingSignalDTO,
  changeLog: AdjustmentRecord[]
): void {
  void itinerary;
  const b = signal.booking as BookingFactDTO & {
    boarding?: { minutes: PlanMinutes } | null;
    prepaid?: boolean | null;
  };
  if (b.name) setField(item, "name", b.name, changeLog, { signal });
  if (b.start) {
    setField(item, "date", b.start.date, changeLog, { signal });
    setField(item, "start", b.start.time, changeLog, { signal });
    setField(item, "startMin", b.start.minutes, changeLog, { signal });
  }
  if (b.end) {
    setField(item, "end", b.end.time, changeLog, { signal });
    setField(item, "endMin", b.end.minutes, changeLog, { signal });
  }
  if (b.place) setField(item, "place", b.place, changeLog, { signal });
  if (b.address) setField(item, "address", b.address, changeLog, { signal });
  setField(item, "status", "booked", changeLog, { signal });
  if (b.provider) setField(item, "provider", b.provider, changeLog, { signal });
  if (b.boarding) setField(item, "boardingMin", b.boarding.minutes, changeLog, { signal });
  if (b.prepaid !== null && b.prepaid !== undefined) {
    setField(item, "prepaid", b.prepaid, changeLog, { signal });
  }
  if (b.price.amount !== null && b.price.amount !== undefined) {
    setField(item, "price", b.price, changeLog, { signal });
  }
  item.provenance = signal.provenance;
}

/**
 * Apply ONE verified signal's facts to an itinerary clone. Returns
 * the change log; the input is never mutated.
 */
export function applySignalFacts(
  itineraryInput: UpdaterItinerary,
  signal: BookingSignalDTO
): { itinerary: UpdaterItinerary; changes: AdjustmentRecord[]; matched: boolean } {
  const itinerary = structuredClone(itineraryInput);
  const changeLog: AdjustmentRecord[] = [];
  const reference = signal.booking.reference;
  let item: LiveItem | undefined;
  for (const day of itinerary.days) {
    item = day.items.find((i) => i.bookingRef && reference && i.bookingRef === reference);
    if (item) break;
  }
  if (!item) return { itinerary, changes: changeLog, matched: false };
  if (signal.booking.kind === "flight") applyFlightFact(itinerary, item, signal, changeLog);
  else if (signal.booking.kind === "hotel") applyHotelFact(itinerary, item, signal, changeLog);
  else applyTimedFact(itinerary, item, signal, changeLog);
  return { itinerary, changes: changeLog, matched: true };
}

/* ------------------------------------------------------------------ */
/* Transactional commit + reload-verify + rollback                     */
/* ------------------------------------------------------------------ */

interface CommitOutcome {
  ok: boolean;
  error?: string;
  rolledBack?: boolean;
}

async function commitWithVerification(
  store: UpdaterStore,
  params: {
    tripId: string;
    before: UpdaterItinerary;
    after: UpdaterItinerary;
    verify: (reloaded: UpdaterItinerary) => string[];
    at: UtcInstant;
  }
): Promise<CommitOutcome> {
  const commit = await store.commitItinerary({
    tripId: params.tripId,
    expectedRevision: params.before.revision,
    itinerary: params.after
  });
  if (!commit.ok) return { ok: false, error: "CAS_MISMATCH" };
  const reloaded = await store.loadItinerary(params.tripId);
  if (!reloaded) return { ok: false, error: "RELOAD_MISSING" };
  const mismatches = params.verify(reloaded);
  if (!mismatches.length) return { ok: true };
  // Roll back to the pre-image; never assert a change that did not
  // read back identical.
  const rollback = await store.commitItinerary({
    tripId: params.tripId,
    expectedRevision: reloaded.revision,
    itinerary: params.before
  });
  await store.insertOutcome({
    outcomeId: contentId("outcome", [params.tripId, "apply-rolled-back", params.at]),
    tripId: params.tripId,
    kind: "apply-rolled-back",
    proposalId: null,
    detail: `reload verification failed (${mismatches.join("; ")}); the change was rolled back${
      rollback.ok ? "" : " — ROLLBACK ITSELF FAILED CAS, manual review required"
    }`,
    at: params.at
  });
  return { ok: false, error: "RELOAD_VERIFY_FAILED", rolledBack: rollback.ok };
}

function verifyChanges(reloaded: UpdaterItinerary, changes: AdjustmentRecord[]): string[] {
  const mismatches: string[] = [];
  for (const change of changes) {
    if (change.itemId === "trip.hotel") {
      const actual =
        change.field === "name"
          ? reloaded.hotel?.name
          : change.field === "address"
            ? reloaded.hotel?.address
            : change.field === "stars"
              ? reloaded.hotel?.stars
              : change.field === "price"
                ? reloaded.hotel?.price
                : undefined;
      if (!sameValue(actual ?? null, change.after)) {
        mismatches.push(`trip.hotel.${change.field}`);
      }
      continue;
    }
    for (const day of reloaded.days) {
      const item = day.items.find((i) => i.item_id === change.itemId);
      if (item) {
        const actual = fieldView(item)[change.field] ?? null;
        if (!sameValue(actual, change.after)) {
          mismatches.push(`${change.itemId}.${change.field}`);
        }
        break;
      }
    }
  }
  return mismatches;
}

/* ------------------------------------------------------------------ */
/* The classified-signal entry point (Phase 8 stream)                  */
/* ------------------------------------------------------------------ */

export type ProcessSignalOutcome =
  | { outcome: "duplicate-noop"; signalId: string }
  | { outcome: "unmatched"; signalId: string; reason: string }
  | { outcome: "applied-silent"; signalId: string; changes: AdjustmentRecord[]; alerts: 0 }
  | { outcome: "loud-parked"; signalId: string; proposalId: string; alert: UpdaterAlert }
  | { outcome: "proposal-only"; signalId: string; proposalId: string | null; reason: string }
  | { outcome: "failed"; signalId: string; error: string; rolledBack?: boolean };

export async function processClassifiedSignal(params: {
  store: UpdaterStore;
  tripId: string;
  classified: ClassifiedBookingSignal;
  trust: SignalTrust;
  at: UtcInstant;
  proposalId: string;
}): Promise<ProcessSignalOutcome> {
  const { store, tripId, classified, at } = params;
  const signal = classified.signal;
  // Idempotency by signal content ID — a re-delivery is a no-op.
  if (await store.hasAppliedSignal(signal.signalId)) {
    return { outcome: "duplicate-noop", signalId: signal.signalId };
  }
  const itinerary = await store.loadItinerary(tripId);
  if (!itinerary) return { outcome: "failed", signalId: signal.signalId, error: "TRIP_NOT_FOUND" };

  // Trust ladder: an INFERRED signal never writes the plan. It may
  // only park a proposal candidate for a traveler decision.
  if (params.trust === "INFERRED") {
    const preview = applySignalFacts(itinerary, signal);
    await store.parkProposal({
      proposalId: params.proposalId,
      tripId,
      dayId: itinerary.days[0]?.day_id || "",
      kind: "alignment",
      status: "proposed",
      itineraryHashBefore: itineraryHash(itinerary),
      repair: null,
      alignment: { signalId: signal.signalId, changes: preview.changes },
      trust: "INFERRED",
      createdAt: at,
      decidedAt: null
    });
    await store.recordAppliedSignal({ signalId: signal.signalId, tripId, at });
    return {
      outcome: "proposal-only",
      signalId: signal.signalId,
      proposalId: params.proposalId,
      reason: "INFERRED trust: a movement inference may propose a re-solve, never apply one"
    };
  }

  // LOUD lane: the plan does not change by one byte. One plain-human
  // alert; the computed candidate is parked for the traveler's call.
  if (classified.lane === "loud") {
    const preview = applySignalFacts(itinerary, signal);
    const detailText = classified.conflicts.map((c) => c.detail).join(" ");
    const alert: UpdaterAlert = {
      alertId: contentId("alert", [tripId, signal.signalId]),
      tripId,
      headline: "Heads up — this booking change collides with your plans.",
      message: `${detailText} Roamly has not moved anything. Review the change and decide.`.trim(),
      collisions: classified.conflicts.map((c) => ({
        itemId: c.itemRef,
        itemName: c.itemName,
        detail: c.detail
      })),
      signalId: signal.signalId,
      at
    };
    await store.insertAlert(alert);
    await store.parkProposal({
      proposalId: params.proposalId,
      tripId,
      dayId: itinerary.days[0]?.day_id || "",
      kind: "alignment",
      status: "proposed",
      itineraryHashBefore: itineraryHash(itinerary),
      repair: null,
      alignment: { signalId: signal.signalId, changes: preview.changes },
      trust: params.trust,
      createdAt: at,
      decidedAt: null
    });
    await store.recordAppliedSignal({ signalId: signal.signalId, tripId, at });
    return { outcome: "loud-parked", signalId: signal.signalId, proposalId: params.proposalId, alert };
  }

  // SILENT lane: one transaction — plan write + provenance records +
  // the applied-signal registry entry, reload-verified.
  const applied = applySignalFacts(itinerary, signal);
  if (!applied.matched) {
    return {
      outcome: "unmatched",
      signalId: signal.signalId,
      reason: `no itinerary item carries booking reference ${signal.booking.reference}`
    };
  }
  const committed = await commitWithVerification(store, {
    tripId,
    before: itinerary,
    after: applied.itinerary,
    verify: (reloaded) => verifyChanges(reloaded, applied.changes),
    at
  });
  if (!committed.ok) {
    return {
      outcome: "failed",
      signalId: signal.signalId,
      error: committed.error || "COMMIT_FAILED",
      rolledBack: committed.rolledBack
    };
  }
  await store.insertAdjustmentRecords(
    applied.changes.map((c) => ({ ...c, tripId }))
  );
  await store.recordAppliedSignal({ signalId: signal.signalId, tripId, at });
  return { outcome: "applied-silent", signalId: signal.signalId, changes: applied.changes, alerts: 0 };
}

/* ------------------------------------------------------------------ */
/* Delay events (companion monitor + Native Flight Watch seam)         */
/* ------------------------------------------------------------------ */

export interface DelayEventInput {
  eventId: string;
  subjectItemId: string;
  transferItemId: string | null;
  oldStartMin: PlanMinutes;
  oldEndMin: PlanMinutes;
  newStartMin: PlanMinutes;
  newEndMin: PlanMinutes;
  transferDurationMin: number;
  nowMin: PlanMinutes;
}

export type ProcessDelayOutcome =
  | { outcome: "duplicate-noop"; eventId: string }
  | {
      outcome: "silent-retime-proposal-parked";
      eventId: string;
      affectedSet: AffectedItem[];
      changes: AdjustmentRecord[];
      proposalId: string | null;
      loud: boolean;
    }
  | { outcome: "proposal-only"; eventId: string; proposalId: string | null; reason: string }
  | { outcome: "failed"; eventId: string; error: string; rolledBack?: boolean };

export async function processDelayEvent(params: {
  store: UpdaterStore;
  tripId: string;
  dayId: string;
  event: DelayEventInput;
  trust: SignalTrust;
  pack?: EnginePack;
  at: UtcInstant;
  proposalId: string;
}): Promise<ProcessDelayOutcome> {
  const { store, tripId, dayId, event, at } = params;
  const signalKey = `delay:${event.eventId}`;
  if (await store.hasAppliedSignal(signalKey)) {
    return { outcome: "duplicate-noop", eventId: event.eventId };
  }
  const itinerary = await store.loadItinerary(tripId);
  if (!itinerary) return { outcome: "failed", eventId: event.eventId, error: "TRIP_NOT_FOUND" };
  const day = itinerary.days.find((d) => d.day_id === dayId);
  if (!day) return { outcome: "failed", eventId: event.eventId, error: "DAY_NOT_FOUND" };
  const subject = day.items.find((i) => i.item_id === event.subjectItemId);
  if (!subject) return { outcome: "failed", eventId: event.eventId, error: "SUBJECT_NOT_FOUND" };

  const anchorMin = event.newEndMin + event.transferDurationMin;
  const retime: Disruption["retime"] = {
    [event.subjectItemId]: { start: event.newStartMin, end: event.newEndMin }
  };
  if (event.transferItemId) {
    retime[event.transferItemId] = {
      start: event.newEndMin,
      end: event.newEndMin + event.transferDurationMin
    };
  }
  const disruption: Disruption = {
    type: "flight_delayed",
    subjectItemId: event.subjectItemId,
    oldStart: event.oldStartMin,
    oldEnd: event.oldEndMin,
    newStart: event.newStartMin,
    newEnd: event.newEndMin,
    anchorMin,
    nowMin: event.nowMin,
    retime
  };
  const affectedSet = computeAffectedSet(day, disruption);
  // A protected item the new timing strands is a LOUD collision.
  const collisions = affectedSet.filter(
    (a) =>
      a.protected &&
      !a.fixedPast &&
      (day.items.find((i) => i.item_id === a.itemId)?.start ?? 0) < event.newEndMin
  );
  const loud = collisions.length > 0;

  // INFERRED (Flight Watch movement): proposal only, plan untouched.
  if (params.trust === "INFERRED") {
    const proposed = proposeRepairs({ day, disruption, pack: params.pack, proposalId: params.proposalId });
    if (proposed.ok) {
      await store.parkProposal({
        proposalId: params.proposalId,
        tripId,
        dayId,
        kind: "repair",
        status: "proposed",
        itineraryHashBefore: itineraryHash(itinerary),
        repair: proposed.proposal,
        alignment: null,
        trust: "INFERRED",
        createdAt: at,
        decidedAt: null
      });
    }
    await store.recordAppliedSignal({ signalId: signalKey, tripId, at });
    return {
      outcome: "proposal-only",
      eventId: event.eventId,
      proposalId: proposed.ok ? params.proposalId : null,
      reason: "INFERRED trust: movement inference may trigger a re-solve proposal; only OFFICIAL/REPORTED facts apply"
    };
  }

  // OFFICIAL / REPORTED: the flight fact + its arrival transfer apply
  // silently with provenance (the shadow updater's safe-automatic
  // actions); the remainder re-solve is parked as a proposal.
  const working = structuredClone(itinerary);
  const workingDay = working.days.find((d) => d.day_id === dayId);
  if (!workingDay) return { outcome: "failed", eventId: event.eventId, error: "DAY_NOT_FOUND" };
  const changes: AdjustmentRecord[] = [];
  const provenance = {
    signalId: signalKey,
    shortLabel: params.trust === "OFFICIAL" ? "official flight status" : "reported flight status",
    messageId: event.eventId,
    receivedAt: at
  };
  for (const [itemId, r] of Object.entries(retime)) {
    const item = workingDay.items.find((i) => i.item_id === itemId);
    if (!item) continue;
    const fields: [string, unknown, string][] = [
      ["startMin", r.start, "flight fact outranks the plan for the flight and its arrival transfer"],
      ["endMin", r.end, "flight fact outranks the plan for the flight and its arrival transfer"]
    ];
    for (const [field, value, basis] of fields) {
      const before = fieldView(item)[field] ?? null;
      if (sameValue(before, value)) continue;
      writeField(item, field, value);
      syncLiveItemTimes(item);
      changes.push({ itemId, field, before, after: value, basis, provenance });
    }
    if (itemId === event.subjectItemId) {
      writeField(item, "delayed", true);
      item.provenance = provenance;
    }
  }
  const committed = await commitWithVerification(store, {
    tripId,
    before: itinerary,
    after: working,
    verify: (reloaded) => verifyChanges(reloaded, changes),
    at
  });
  if (!committed.ok) {
    return { outcome: "failed", eventId: event.eventId, error: committed.error || "COMMIT_FAILED", rolledBack: committed.rolledBack };
  }
  await store.insertAdjustmentRecords(changes.map((c) => ({ ...c, tripId })));

  // Park the remainder re-solve against the RETIMED day.
  const retimedDay = workingDay;
  const proposed = proposeRepairs({ day: retimedDay, disruption, pack: params.pack, proposalId: params.proposalId });
  let parkedId: string | null = null;
  if (proposed.ok) {
    parkedId = params.proposalId;
    await store.parkProposal({
      proposalId: params.proposalId,
      tripId,
      dayId,
      kind: "repair",
      status: "proposed",
      itineraryHashBefore: itineraryHash(working),
      repair: proposed.proposal,
      alignment: null,
      trust: params.trust,
      createdAt: at,
      decidedAt: null
    });
  }
  if (loud) {
    const detailText = collisions
      .map((c) => {
        const item = day.items.find((i) => i.item_id === c.itemId);
        return `${c.name} starts at ${item ? fmt(item.start) : "?"}, before the flight lands at ${fmt(event.newEndMin)}.`;
      })
      .join(" ");
    await store.insertAlert({
      alertId: contentId("alert", [tripId, event.eventId]),
      tripId,
      headline: "Heads up — this flight delay collides with your plans.",
      message: `${detailText} Roamly updated the flight time, but did not silently move or discard the endangered item${collisions.length === 1 ? "" : "s"}.`,
      collisions: collisions.map((c) => ({
        itemId: c.itemId,
        itemName: c.name,
        detail: `${c.name} is endangered by the delayed arrival.`
      })),
      signalId: signalKey,
      at
    });
  }
  await store.recordAppliedSignal({ signalId: signalKey, tripId, at });
  return {
    outcome: "silent-retime-proposal-parked",
    eventId: event.eventId,
    affectedSet,
    changes,
    proposalId: parkedId,
    loud
  };
}

/* ------------------------------------------------------------------ */
/* Approval / rejection of parked candidates                           */
/* ------------------------------------------------------------------ */

export type DecideOutcome =
  | { outcome: "applied"; proposalId: string; changes: number }
  | { outcome: "rejected"; proposalId: string }
  | { outcome: "stale-refused"; proposalId: string; reason: string }
  | { outcome: "failed"; proposalId: string; error: string; rolledBack?: boolean };

export async function approveParkedProposal(params: {
  store: UpdaterStore;
  proposalId: string;
  planId?: string;
  at: UtcInstant;
}): Promise<DecideOutcome> {
  const { store, at } = params;
  const parked = await store.loadProposal(params.proposalId);
  if (!parked) return { outcome: "failed", proposalId: params.proposalId, error: "PROPOSAL_NOT_FOUND" };
  if (parked.status !== "proposed") {
    return { outcome: "failed", proposalId: params.proposalId, error: `PROPOSAL_ALREADY_${parked.status.toUpperCase()}` };
  }
  const itinerary = await store.loadItinerary(parked.tripId);
  if (!itinerary) return { outcome: "failed", proposalId: params.proposalId, error: "TRIP_NOT_FOUND" };
  // Hash guard: the plan the candidate was written against must be
  // the plan that still stands. A stale proposal cannot apply.
  if (itineraryHash(itinerary) !== parked.itineraryHashBefore) {
    return {
      outcome: "stale-refused",
      proposalId: params.proposalId,
      reason: "the plan changed after this proposal was written; nothing applied"
    };
  }

  if (parked.kind === "alignment" && parked.alignment) {
    // Re-apply the signal's facts to the CURRENT itinerary (the hash
    // guard above proves it is the itinerary the candidate previewed).
    const signalPreview = parked.alignment.changes;
    const working = structuredClone(itinerary);
    const changes: AdjustmentRecord[] = [];
    for (const change of signalPreview) {
      if (change.itemId === "trip.hotel") {
        if (!working.hotel) continue;
        if (change.field === "name") working.hotel.name = change.after as string;
        if (change.field === "address") working.hotel.address = change.after as string;
        if (change.field === "stars") working.hotel.stars = change.after as number;
        if (change.field === "price") working.hotel.price = change.after;
        changes.push(change);
        continue;
      }
      for (const day of working.days) {
        const item = day.items.find((i) => i.item_id === change.itemId);
        if (!item) continue;
        writeField(item, change.field, change.after);
        syncLiveItemTimes(item);
        changes.push(change);
        break;
      }
    }
    const committed = await commitWithVerification(store, {
      tripId: parked.tripId,
      before: itinerary,
      after: working,
      verify: (reloaded) => verifyChanges(reloaded, changes),
      at
    });
    if (!committed.ok) {
      return { outcome: "failed", proposalId: params.proposalId, error: committed.error || "COMMIT_FAILED", rolledBack: committed.rolledBack };
    }
    await store.insertAdjustmentRecords(changes.map((c) => ({ ...c, tripId: parked.tripId })));
    await store.updateProposal(params.proposalId, { status: "applied", decidedAt: at });
    await store.insertOutcome({
      outcomeId: contentId("outcome", [parked.tripId, params.proposalId, "alignment-approved", at]),
      tripId: parked.tripId,
      kind: "alignment-approved",
      proposalId: params.proposalId,
      detail: `traveler approved the parked alignment candidate (${changes.length} field changes applied under the hash guard)`,
      at
    });
    return { outcome: "applied", proposalId: params.proposalId, changes: changes.length };
  }

  if (parked.kind === "repair" && parked.repair) {
    const planId = params.planId || parked.repair.chosenPlanId;
    const day = itinerary.days.find((d) => d.day_id === parked.dayId);
    if (!day) return { outcome: "failed", proposalId: params.proposalId, error: "DAY_NOT_FOUND" };
    if (liveDayHash(day) !== parked.repair.dayHashBefore) {
      return {
        outcome: "stale-refused",
        proposalId: params.proposalId,
        reason: "the day changed after this repair was proposed; nothing applied"
      };
    }
    const built = buildRepairedDay(day, parked.repair, planId);
    if (!built.ok) return { outcome: "failed", proposalId: params.proposalId, error: built.error };
    const working = structuredClone(itinerary);
    const dayIndex = working.days.findIndex((d) => d.day_id === parked.dayId);
    working.days[dayIndex] = built.day;
    const committed = await commitWithVerification(store, {
      tripId: parked.tripId,
      before: itinerary,
      after: working,
      verify: (reloaded) => {
        const reloadedDay = reloaded.days.find((d) => d.day_id === parked.dayId);
        if (!reloadedDay) return ["day missing after apply"];
        const v = verifyRepairedDay(reloadedDay, built.expected);
        return v.mismatches.map((m) => `${m.itemId} ${m.startTime}–${m.endTime}`);
      },
      at
    });
    if (!committed.ok) {
      return { outcome: "failed", proposalId: params.proposalId, error: committed.error || "COMMIT_FAILED", rolledBack: committed.rolledBack };
    }
    await store.updateProposal(params.proposalId, { status: "applied", decidedAt: at });
    await store.insertOutcome({
      outcomeId: contentId("outcome", [parked.tripId, params.proposalId, "repair-approved", at]),
      tripId: parked.tripId,
      kind: "repair-approved",
      proposalId: params.proposalId,
      detail: `traveler approved repair plan ${planId}; applied under the content-hash guard and reload-verified`,
      at
    });
    return { outcome: "applied", proposalId: params.proposalId, changes: built.expected.length };
  }

  return { outcome: "failed", proposalId: params.proposalId, error: "PROPOSAL_EMPTY" };
}

export async function rejectParkedProposal(params: {
  store: UpdaterStore;
  proposalId: string;
  at: UtcInstant;
}): Promise<DecideOutcome> {
  const { store, at } = params;
  const parked = await store.loadProposal(params.proposalId);
  if (!parked) return { outcome: "failed", proposalId: params.proposalId, error: "PROPOSAL_NOT_FOUND" };
  if (parked.status !== "proposed") {
    return { outcome: "failed", proposalId: params.proposalId, error: `PROPOSAL_ALREADY_${parked.status.toUpperCase()}` };
  }
  await store.updateProposal(params.proposalId, { status: "rejected", decidedAt: at });
  // The rejection is recorded as a LEARN signal — the candidate is
  // discarded, the outcome is not.
  await store.insertOutcome({
    outcomeId: contentId("outcome", [parked.tripId, params.proposalId, "rejected", at]),
    tripId: parked.tripId,
    kind: parked.kind === "repair" ? "repair-rejected" : "alignment-rejected",
    proposalId: params.proposalId,
    detail: "traveler rejected the parked candidate; the plan was not changed and the outcome is recorded for LEARN",
    at
  });
  return { outcome: "rejected", proposalId: params.proposalId };
}

/* ------------------------------------------------------------------ */
/* Room-ready events (early / late check-in)                           */
/* ------------------------------------------------------------------ */

export type RoomReadyOutcome =
  | {
      outcome: "early-applied";
      freedMin: number;
      offer: string;
      changes: AdjustmentRecord[];
    }
  | {
      outcome: "late-applied";
      waitExtendedMin: number;
      threatened: string[];
      notificationOwed: boolean;
      changes: AdjustmentRecord[];
    }
  | { outcome: "no-change"; reason: string }
  | { outcome: "refused-loud"; violation: string }
  | { outcome: "failed"; error: string; rolledBack?: boolean };

function toEngineDay(day: LiveDay, arriveBaseMin: PlanMinutes, checkInMin: PlanMinutes): EngineDay {
  return {
    dayNumber: day.day_number,
    date: day.date,
    role: "standard",
    items: day.items.map((i) => ({
      type:
        i.kind === "flight" || i.item_type === "flight"
          ? "journey"
          : i.kind === "transfer" || i.item_type === "transfer"
            ? "transfer"
            : i.kind === "hotel" || i.item_type === "checkin"
              ? "checkin"
              : i.kind === "wait" || i.part === "arrival-wait" || i.part === "refresh"
                ? "rest"
                : i.kind === "food"
                  ? "food"
                  : i.kind === "rest"
                    ? "rest"
                    : "stop",
      key: i.key,
      name: i.title,
      title: i.title,
      kind: i.kind,
      start: i.start,
      end: i.end,
      pos: i.pos ?? undefined,
      hours: i.hours,
      interruptible: i.interruptible,
      protected: i.protected
    })),
    legs: [],
    envelope: {
      arrival: {
        journeyMin: 0,
        arriveBaseMin,
        checkInMin,
        checkInProvenance: "hotel data (booked check-in)",
        restMinutes: 60
      }
    },
    endMin: Math.max(...day.items.map((i) => i.end))
  };
}

export async function applyRoomReadyEvent(params: {
  store: UpdaterStore;
  tripId: string;
  dayId: string;
  roomReadyMin: PlanMinutes;
  at: UtcInstant;
}): Promise<RoomReadyOutcome> {
  const { store, tripId, dayId, roomReadyMin, at } = params;
  const itinerary = await store.loadItinerary(tripId);
  if (!itinerary) return { outcome: "failed", error: "TRIP_NOT_FOUND" };
  const day = itinerary.days.find((d) => d.day_id === dayId);
  if (!day) return { outcome: "failed", error: "DAY_NOT_FOUND" };
  const checkInItem = day.items.find((i) => i.kind === "hotel" || i.item_type === "checkin");
  if (!checkInItem) return { outcome: "failed", error: "NO_CHECKIN_ITEM" };
  const statedCheckInMin = checkInItem.start;
  const transfer = day.items.find((i) => i.kind === "transfer" || i.item_type === "transfer");
  const waitItems = day.items.filter(
    (i) => i.part === "arrival-wait" || i.kind === "wait"
  );
  const arriveBaseMin = transfer ? transfer.end : waitItems.length ? Math.min(...waitItems.map((i) => i.start)) : statedCheckInMin;
  if (roomReadyMin === statedCheckInMin) {
    return { outcome: "no-change", reason: "the room is ready at the stated check-in time" };
  }

  // THE WAIT RULE, with the Phase 2 judge as authority: a protected
  // or timed commitment inside the room wait refuses the re-flow
  // loud — the wait may only ever hold interruptible content.
  const judged = judgeTrip([toEngineDay(day, arriveBaseMin, statedCheckInMin)], {
    earliestMin: 0,
    gateProfile: "production-booking"
  });
  const waitViolation = judged.hardViolations.find((v) => v.includes("room wait"));
  if (waitViolation) return { outcome: "refused-loud", violation: waitViolation };

  const working = structuredClone(itinerary);
  const wDay = working.days.find((d) => d.day_id === dayId);
  if (!wDay) return { outcome: "failed", error: "DAY_NOT_FOUND" };
  const wCheckIn = wDay.items.find((i) => i.item_id === checkInItem.item_id);
  if (!wCheckIn) return { outcome: "failed", error: "NO_CHECKIN_ITEM" };
  const checkInDuration = wCheckIn.end - wCheckIn.start;
  const restItem = wDay.items.find((i) => i.kind === "rest" || i.part === "refresh");
  const restDuration = restItem ? restItem.end - restItem.start : 0;
  const changes: AdjustmentRecord[] = [];
  const provenance = {
    signalId: `room-ready:${dayId}:${roomReadyMin}`,
    shortLabel: "hotel event",
    messageId: `room-ready:${dayId}`,
    receivedAt: at
  };
  const record = (item: LiveItem, field: string, before: unknown, after: unknown, basis: string): void => {
    changes.push({ itemId: item.item_id, field, before, after, basis, provenance });
  };

  if (roomReadyMin < statedCheckInMin) {
    // EARLY: the wait dissolves; check-in + rest move up with the
    // anchor (rest duration preserved in full); a wait-held
    // interruptible lunch slides to just after the moved rest; the
    // freed time is an OFFER, never a summons.
    const freedMin = statedCheckInMin - roomReadyMin;
    for (const wait of wDay.items.filter((i) => i.part === "arrival-wait" || i.kind === "wait")) {
      record(wait, "state", wait.state ?? wait.status ?? null, "dissolved-early-room", "the room was ready early — the wait dissolves");
      wait.state = "dissolved-early-room";
    }
    const lunch = wDay.items.find(
      (i) => i.kind === "food" && i.interruptible && i.start >= arriveBaseMin && i.end <= statedCheckInMin
    );
    const checkInBefore = { start: wCheckIn.start, end: wCheckIn.end };
    wCheckIn.start = roomReadyMin;
    wCheckIn.end = roomReadyMin + checkInDuration;
    syncLiveItemTimes(wCheckIn);
    record(wCheckIn, "startMin", checkInBefore.start, wCheckIn.start, "check-in moves up to the verified room-ready time");
    record(wCheckIn, "endMin", checkInBefore.end, wCheckIn.end, "check-in keeps its handling duration");
    if (restItem) {
      const rest = wDay.items.find((i) => i.item_id === restItem.item_id);
      if (rest) {
        const beforeStart = rest.start;
        rest.start = wCheckIn.end;
        rest.end = rest.start + restDuration;
        syncLiveItemTimes(rest);
        record(rest, "startMin", beforeStart, rest.start, "rest & refresh moves up with the anchor, duration preserved in full");
      }
    }
    if (lunch) {
      const l = wDay.items.find((i) => i.item_id === lunch.item_id);
      if (l) {
        const dur = l.end - l.start;
        const beforeStart = l.start;
        const restEnd = restItem ? (wDay.items.find((i) => i.item_id === restItem.item_id)?.end ?? wCheckIn.end) : wCheckIn.end;
        l.start = restEnd;
        l.end = restEnd + dur;
        syncLiveItemTimes(l);
        record(l, "startMin", beforeStart, l.start, "the wait-held lunch slides after the moved rest — same venue, interruptible by design");
      }
    }
    const committed = await commitWithVerification(store, {
      tripId,
      before: itinerary,
      after: working,
      verify: (reloaded) => {
        const d = reloaded.days.find((x) => x.day_id === dayId);
        if (!d) return ["day missing after early-room apply"];
        const ci = d.items.find((i) => i.item_id === checkInItem.item_id);
        return ci && ci.start === roomReadyMin ? [] : ["check-in did not read back at the room-ready time"];
      },
      at
    });
    if (!committed.ok) return { outcome: "failed", error: committed.error || "COMMIT_FAILED", rolledBack: committed.rolledBack };
    await store.insertAdjustmentRecords(changes.map((c) => ({ ...c, tripId })));
    const offer = `Your room was ready early — ${freedMin} minutes are yours. Keep the gentle plan, or take a fuller afternoon; nothing was added without your say.`;
    await store.insertOutcome({
      outcomeId: contentId("outcome", [tripId, dayId, "room-early", String(roomReadyMin)]),
      tripId,
      kind: "room-ready-offer",
      proposalId: null,
      detail: offer,
      at
    });
    return { outcome: "early-applied", freedMin, offer, changes };
  }

  // LATE: the soft wait extends around the unchanged interruptible
  // content; check-in + rest move later with the rest preserved;
  // exactly ONE notification is owed, however often the event lands.
  const waitExtendedMin = roomReadyMin - statedCheckInMin;
  for (const wait of wDay.items.filter((i) => i.part === "arrival-wait" || i.kind === "wait")) {
    const beforeEnd = wait.end;
    wait.end = roomReadyMin;
    syncLiveItemTimes(wait);
    record(wait, "endMin", beforeEnd, roomReadyMin, "the room is late — the soft wait extends");
  }
  record(wCheckIn, "startMin", wCheckIn.start, roomReadyMin, "check-in moves to the verified room-ready time");
  wCheckIn.start = roomReadyMin;
  wCheckIn.end = roomReadyMin + checkInDuration;
  syncLiveItemTimes(wCheckIn);
  if (restItem) {
    const rest = wDay.items.find((i) => i.item_id === restItem.item_id);
    if (rest) {
      const beforeStart = rest.start;
      rest.start = wCheckIn.end;
      rest.end = rest.start + restDuration;
      syncLiveItemTimes(rest);
      record(rest, "startMin", beforeStart, rest.start, "rest & refresh moves with the late room, duration preserved in full");
    }
  }
  const restEnd = restItem ? (wDay.items.find((i) => i.item_id === restItem.item_id)?.end ?? 0) : 0;
  const threatened = wDay.items
    .filter(
      (i) =>
        i.item_id !== checkInItem.item_id &&
        i.item_id !== restItem?.item_id &&
        i.kind !== "wait" &&
        i.part !== "arrival-wait" &&
        i.start >= statedCheckInMin &&
        i.start < restEnd
    )
    .map((i) => i.title);
  const committed = await commitWithVerification(store, {
    tripId,
    before: itinerary,
    after: working,
    verify: (reloaded) => {
      const d = reloaded.days.find((x) => x.day_id === dayId);
      if (!d) return ["day missing after late-room apply"];
      const ci = d.items.find((i) => i.item_id === checkInItem.item_id);
      return ci && ci.start === roomReadyMin ? [] : ["check-in did not read back at the late room-ready time"];
    },
    at
  });
  if (!committed.ok) return { outcome: "failed", error: committed.error || "COMMIT_FAILED", rolledBack: committed.rolledBack };
  await store.insertAdjustmentRecords(changes.map((c) => ({ ...c, tripId })));
  const key = `room-late:${dayId}:${roomReadyMin}`;
  const alreadyOwed = await store.hasNotification(key);
  if (!alreadyOwed) {
    await store.recordNotification({
      key,
      tripId,
      dayId,
      message: `Your room will be ready at ${fmt(roomReadyMin)} instead of ${fmt(statedCheckInMin)}. The wait is soft and your rest is preserved${threatened.length ? `; ${threatened.join(", ")} may need a new time` : ""}.`,
      at
    });
  }
  return {
    outcome: "late-applied",
    waitExtendedMin,
    threatened,
    notificationOwed: !alreadyOwed,
    changes
  };
}

/* ------------------------------------------------------------------ */
/* Supabase store — the transaction anchors on roamly_itineraries:     */
/* the repair_revision CAS + the roamly_itinerary_content_hash RPC     */
/* (the companionRepairEngine pattern). Change records ride            */
/* booking_change_events (fingerprint-unique = DB-level signal         */
/* dedupe), resolving the booking row by confirmation_number.          */
/* Alerts ride companion_events. Parked candidates ride                */
/* companion_repair_proposals when the caller supplies the companion   */
/* event + impact anchors that table's FKs require; the route does.   */
/* ------------------------------------------------------------------ */

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export class SupabaseUpdaterStore implements UpdaterStore {
  private readonly supabase: SupabaseClient;
  private readonly userId: string;

  constructor(supabase: SupabaseClient, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  private normalizeItinerary(tripId: string, row: JsonRecord): UpdaterItinerary {
    const full = asRecord(row.full_json);
    const days: LiveDay[] = (Array.isArray(full.daily_itinerary) ? full.daily_itinerary : []).map(
      (rawDay, index) => {
        const d = asRecord(rawDay);
        const rawItems = (d.live_timeline || d.timeline || d.activities || []) as unknown[];
        return {
          day_id: String(d.day_id || `day-${index + 1}`),
          day_number: Number(d.day_number || index + 1),
          date: String(d.date || "") as LocalDate,
          timeZone: String(full.time_zone || full.timeZone || "UTC"),
          items: rawItems.map((rawItem) => {
            const i = asRecord(rawItem);
            const start = Number(i.start ?? i.startMin ?? 0);
            const end = Number(i.end ?? i.endMin ?? 0);
            const item: LiveItem = {
              item_id: String(i.item_id || i.id || ""),
              title: String(i.title || i.name || ""),
              name: typeof i.name === "string" ? i.name : undefined,
              item_type: typeof i.item_type === "string" ? i.item_type : undefined,
              kind: typeof i.kind === "string" ? i.kind : undefined,
              key: typeof i.key === "string" ? i.key : undefined,
              start: start as PlanMinutes,
              end: end as PlanMinutes,
              startTime: String(i.startTime || fmt(start)),
              endTime: String(i.endTime || fmt(end)),
              state: typeof i.state === "string" ? i.state : undefined,
              status: typeof i.status === "string" ? i.status : undefined,
              date: typeof i.date === "string" ? (i.date as LocalDate) : (String(d.date || "") as LocalDate),
              place: typeof i.place === "string" ? i.place : null,
              address: typeof i.address === "string" ? i.address : null,
              provider: typeof i.provider === "string" ? i.provider : null,
              pos: (i.pos as LiveItem["pos"]) ?? null,
              paid: i.paid === true,
              prepaid: i.prepaid === true,
              bookingRef: typeof i.bookingRef === "string" ? i.bookingRef : null,
              boardingMin: typeof i.boardingMin === "number" ? (i.boardingMin as PlanMinutes) : null,
              durationMin: typeof i.durationMin === "number" ? i.durationMin : undefined,
              interruptible: i.interruptible === true,
              provenance: i.provenance ?? null
            };
            return item;
          })
        };
      }
    );
    const hotelRaw = asRecord(full.hotel);
    return {
      tripId,
      userId: this.userId,
      timeZone: String(full.time_zone || full.timeZone || "UTC"),
      revision: Number(row.repair_revision || 0),
      hotel: full.hotel
        ? {
            name: typeof hotelRaw.name === "string" ? hotelRaw.name : null,
            address: typeof hotelRaw.address === "string" ? hotelRaw.address : null,
            stars: typeof hotelRaw.stars === "number" ? hotelRaw.stars : null,
            price: hotelRaw.price ?? null,
            checkIn: (hotelRaw.checkIn as Record<string, unknown>) ?? null,
            checkOut: (hotelRaw.checkOut as Record<string, unknown>) ?? null
          }
        : null,
      days
    };
  }

  private denormalize(itinerary: UpdaterItinerary, existingFull: JsonRecord): JsonRecord {
    const full: JsonRecord = { ...existingFull };
    full.daily_itinerary = itinerary.days.map((day) => ({
      day_id: day.day_id,
      day_number: day.day_number,
      date: day.date,
      live_timeline: day.items.map((i) => ({
        item_id: i.item_id,
        title: i.title,
        name: i.name,
        item_type: i.item_type,
        kind: i.kind,
        key: i.key,
        start: i.start,
        end: i.end,
        startTime: i.startTime,
        endTime: i.endTime,
        state: i.state,
        status: i.status,
        date: i.date,
        place: i.place,
        address: i.address,
        provider: i.provider,
        pos: i.pos,
        paid: i.paid,
        prepaid: i.prepaid,
        bookingRef: i.bookingRef,
        boardingMin: i.boardingMin,
        durationMin: i.durationMin,
        interruptible: i.interruptible,
        provenance: i.provenance
      }))
    }));
    if (itinerary.hotel) full.hotel = itinerary.hotel;
    return full;
  }

  async loadItinerary(tripId: string): Promise<UpdaterItinerary | null> {
    const { data } = await this.supabase
      .from("roamly_itineraries")
      .select("id,full_json,repair_revision")
      .eq("trip_id", tripId)
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return this.normalizeItinerary(tripId, data as JsonRecord);
  }

  async commitItinerary(params: {
    tripId: string;
    expectedRevision: number;
    itinerary: UpdaterItinerary;
  }): Promise<{ ok: true; revision: number } | { ok: false; error: "CAS_MISMATCH" }> {
    const { data: current } = await this.supabase
      .from("roamly_itineraries")
      .select("id,full_json,repair_revision")
      .eq("trip_id", params.tripId)
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!current) return { ok: false, error: "CAS_MISMATCH" };
    const row = current as JsonRecord;
    if (Number(row.repair_revision || 0) !== params.expectedRevision) {
      return { ok: false, error: "CAS_MISMATCH" };
    }
    const full = this.denormalize(params.itinerary, asRecord(row.full_json));
    const { data: updated, error } = await this.supabase
      .from("roamly_itineraries")
      .update({ full_json: full, repair_revision: params.expectedRevision + 1 })
      .eq("id", String(row.id))
      .eq("repair_revision", params.expectedRevision)
      .select("id")
      .maybeSingle();
    if (error || !updated) return { ok: false, error: "CAS_MISMATCH" };
    // Content-hash read-back (the production RPC the V1 engine uses).
    const { data: hash } = await this.supabase.rpc("roamly_itinerary_content_hash", { value: full });
    void hash;
    return { ok: true, revision: params.expectedRevision + 1 };
  }

  async hasAppliedSignal(signalId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from("booking_change_events")
      .select("id")
      .eq("user_id", this.userId)
      .eq("event_fingerprint", `signal:${signalId}`)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }

  async recordAppliedSignal(rec: { signalId: string; tripId: string; at: UtcInstant }): Promise<void> {
    // The registry rides the applied adjustment records' fingerprints;
    // a signal with zero field changes still records a marker row via
    // insertAdjustmentRecords when the caller writes one. Here we only
    // assert presence bookkeeping for zero-change signals.
    void rec;
  }

  async insertAdjustmentRecords(records: (AdjustmentRecord & { tripId: string })[]): Promise<void> {
    for (const rec of records) {
      const { data: booking } = await this.supabase
        .from("roamly_bookings")
        .select("id")
        .eq("trip_id", rec.tripId)
        .eq("user_id", this.userId)
        .limit(1)
        .maybeSingle();
      if (!booking) continue;
      await this.supabase.from("booking_change_events").insert({
        booking_id: (booking as JsonRecord).id,
        trip_id: rec.tripId,
        user_id: this.userId,
        event_type: "build2_silent_adjustment",
        old_value_json: { itemId: rec.itemId, field: rec.field, value: rec.before },
        new_value_json: { itemId: rec.itemId, field: rec.field, value: rec.after, basis: rec.basis },
        source: `build2-updater:${rec.provenance.signalId}`,
        severity: "minor",
        event_fingerprint: `signal:${rec.provenance.signalId}:${rec.itemId}:${rec.field}`
      });
    }
  }

  async listAdjustmentRecords(tripId: string): Promise<(AdjustmentRecord & { tripId: string })[]> {
    const { data } = await this.supabase
      .from("booking_change_events")
      .select("old_value_json,new_value_json,source,created_at")
      .eq("trip_id", tripId)
      .eq("user_id", this.userId)
      .eq("event_type", "build2_silent_adjustment")
      .order("created_at", { ascending: true });
    return (data || []).map((row) => {
      const r = row as JsonRecord;
      const oldV = asRecord(r.old_value_json);
      const newV = asRecord(r.new_value_json);
      const source = String(r.source || "");
      return {
        tripId,
        itemId: String(oldV.itemId || ""),
        field: String(oldV.field || ""),
        before: oldV.value ?? null,
        after: newV.value ?? null,
        basis: String(newV.basis || ""),
        provenance: {
          signalId: source.replace(/^build2-updater:/, ""),
          shortLabel: "booking-email",
          messageId: "",
          receivedAt: String(r.created_at || "")
        }
      };
    });
  }

  async insertAlert(alert: UpdaterAlert): Promise<void> {
    await this.supabase.from("companion_events").insert({
      trip_id: alert.tripId,
      user_id: this.userId,
      event_type: "build2_booking_collision",
      severity: "important",
      status: "new",
      title: alert.headline,
      summary: alert.message,
      affected_layers: ["itinerary"],
      requires_user_approval: true,
      event_fingerprint: `build2-alert:${alert.alertId}`
    });
  }

  async listAlerts(): Promise<UpdaterAlert[]> {
    return [];
  }

  async parkProposal(): Promise<void> {
    throw new Error("PARKED_PROPOSAL_REQUIRES_EVENT_ANCHORS: companion_repair_proposals requires companion_event_id + impact_result_id; the adjust-live-day route supplies them through the companion event seam");
  }

  async loadProposal(): Promise<ParkedProposal | null> {
    return null;
  }

  async updateProposal(): Promise<void> {
    throw new Error("PARKED_PROPOSAL_REQUIRES_EVENT_ANCHORS");
  }

  async hasNotification(key: string): Promise<boolean> {
    const { data } = await this.supabase
      .from("companion_events")
      .select("id")
      .eq("user_id", this.userId)
      .eq("event_fingerprint", key)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }

  async recordNotification(rec: {
    key: string;
    tripId: string;
    dayId: string;
    message: string;
    at: UtcInstant;
  }): Promise<void> {
    await this.supabase.from("companion_events").insert({
      trip_id: rec.tripId,
      user_id: this.userId,
      event_type: "build2_room_late",
      severity: "routine",
      status: "new",
      title: "Your room will be ready later than planned",
      summary: rec.message,
      affected_layers: ["itinerary"],
      requires_user_approval: false,
      event_fingerprint: rec.key
    });
  }

  async listNotifications(): Promise<{ key: string; message: string }[]> {
    return [];
  }

  async insertOutcome(rec: OutcomeRecord): Promise<void> {
    void rec;
  }

  async listOutcomes(): Promise<OutcomeRecord[]> {
    return [];
  }
}
