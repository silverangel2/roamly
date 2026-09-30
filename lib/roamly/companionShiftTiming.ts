import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTripBundle } from "@/lib/trips";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type ShiftTarget = {
  itemId: string;
  dayId: string;
  title: string;
  startKey: "startTime" | "start_time";
  endKey: "endTime" | "end_time" | null;
  beforeStart: string;
  beforeEnd: string | null;
  shiftMinutes: number;
  afterStart: string;
  afterEnd: string | null;
};

export type ShiftTimingContext = {
  itineraryId: string;
  shiftMinutes: number;
  shifts: ShiftTarget[];
  expectedRevision: number;
  expectedContentHash: string;
  expectedEventFingerprint: string;
  expectedSourceBookingUpdatedAt: string;
};

type ShiftContextResult =
  | { ok: true; context: ShiftTimingContext }
  | { ok: false; error: string };

const BLOCKED_ITEM_STATES = new Set([
  "started",
  "in_progress",
  "completed",
  "done",
  "skipped",
  "missed",
  "checked_in",
  "cancelled"
]);

const MAX_SHIFT_TARGETS = 8;

/**
 * Shift a clock value by whole minutes. Handles ISO datetimes (shifted as an
 * instant, returned as ISO) and wall-clock "HH:MM" / "HH:MM:SS" (rolled over
 * mod 24h). Returns null when the format is not understood — the caller must
 * skip the item rather than invent a time.
 */
export function shiftClockValue(value: string, minutes: number): string | null {
  if (!value || !Number.isSafeInteger(minutes) || minutes === 0) return null;

  if (/T\d{2}:\d{2}/.test(value)) {
    const instant = new Date(value).getTime();
    if (!Number.isFinite(instant)) return null;
    return new Date(instant + minutes * 60_000).toISOString();
  }

  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const total =
      (((parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + minutes) % 1440) + 1440) % 1440;
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return match[3] !== undefined ? `${hh}:${mm}:${match[3]}` : `${hh}:${mm}`;
  }

  return null;
}

function clockMinutes(value: string): number | null {
  const iso = value.match(/T(\d{2}):(\d{2})/);
  if (iso) return parseInt(iso[1], 10) * 60 + parseInt(iso[2], 10);
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  return null;
}

function normalizedFlightNumber(value: unknown): string {
  return asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isFlightItem(item: JsonRecord, booking: JsonRecord): boolean {
  const flightNumber = normalizedFlightNumber(booking.flight_number);
  if (!flightNumber) return false;
  const itemFlight = normalizedFlightNumber(item.flight_number);
  if (itemFlight && (itemFlight === flightNumber || itemFlight.endsWith(flightNumber) || flightNumber.endsWith(itemFlight))) {
    return true;
  }
  const haystack = `${asString(item.title)} ${asString(item.description)}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return haystack.includes(flightNumber);
}

function normalizedTitle(value: unknown): string {
  return asString(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleMatchesBooking(itemTitle: string, booking: JsonRecord): boolean {
  const bookingTitle = normalizedTitle(booking.title);
  const item = normalizedTitle(itemTitle);
  if (!bookingTitle || !item) return false;
  if (bookingTitle === item) return true;
  const flight = normalizedFlightNumber(booking.flight_number);
  if (flight.length >= 3 && item.replace(/[^a-z0-9]/g, "").includes(flight)) return true;
  return false;
}

function itemStart(item: JsonRecord): { key: "startTime" | "start_time"; value: string } | null {
  const startTime = asString(item.startTime);
  if (startTime) return { key: "startTime", value: startTime };
  const start_time = asString(item.start_time);
  if (start_time) return { key: "start_time", value: start_time };
  return null;
}

function itemEnd(item: JsonRecord): { key: "endTime" | "end_time"; value: string } | null {
  const endTime = asString(item.endTime);
  if (endTime) return { key: "endTime", value: endTime };
  const end_time = asString(item.end_time);
  if (end_time) return { key: "end_time", value: end_time };
  return null;
}

function stableKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Build a provider-validated shift plan for a flight delay / schedule change.
 * The delta comes only from the monitor's old/new booking rows (provider
 * times); targets are the impact analysis's affected items on the flight's
 * day, excluding the flight itself, booking-anchored items (reservation
 * truth), and anything already started/completed/skipped.
 */
export async function buildShiftTimingContext(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  event: JsonRecord;
  impact: JsonRecord;
}): Promise<ShiftContextResult> {
  const eventType = asString(params.event.event_type);
  if (!["flight_delayed", "flight_time_changed"].includes(eventType)) {
    return { ok: false, error: "COMPANION_SHIFT_EVENT_NOT_SUPPORTED" };
  }

  const fingerprint = asString(params.event.event_fingerprint);
  const sourceBookingId = asString(params.event.source_booking_id);
  if (!fingerprint || !sourceBookingId) {
    return { ok: false, error: "COMPANION_SHIFT_EVIDENCE_INCOMPLETE" };
  }

  const changeEvent = await params.supabase
    .from("booking_change_events")
    .select("old_value_json,new_value_json")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .eq("event_fingerprint", fingerprint)
    .maybeSingle();
  if (changeEvent.error || !changeEvent.data) {
    return { ok: false, error: changeEvent.error?.message || "COMPANION_SHIFT_CHANGE_EVENT_NOT_FOUND" };
  }

  const oldBooking = asRecord(changeEvent.data.old_value_json);
  const newBooking = asRecord(changeEvent.data.new_value_json);

  // Provider-validated delta only: prefer departure shift, fall back to arrival.
  let shiftMinutes: number | null = null;
  const oldStart = Date.parse(asString(oldBooking.start_at));
  const newStart = Date.parse(asString(newBooking.start_at));
  if (Number.isFinite(oldStart) && Number.isFinite(newStart)) {
    shiftMinutes = Math.round((newStart - oldStart) / 60_000);
  }
  if ((shiftMinutes === null || shiftMinutes === 0)) {
    const oldEnd = Date.parse(asString(oldBooking.end_at));
    const newEnd = Date.parse(asString(newBooking.end_at));
    if (Number.isFinite(oldEnd) && Number.isFinite(newEnd)) {
      shiftMinutes = Math.round((newEnd - oldEnd) / 60_000);
    }
  }
  if (shiftMinutes === null || !Number.isSafeInteger(shiftMinutes) || shiftMinutes === 0 || Math.abs(shiftMinutes) < 5) {
    return { ok: false, error: "COMPANION_SHIFT_DELTA_NOT_PROVEN" };
  }
  const deltaMinutes = shiftMinutes;

  const booking = await params.supabase
    .from("roamly_bookings")
    .select("id,updated_at,flight_number,title")
    .eq("id", sourceBookingId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .eq("booking_type", "flight")
    .is("superseded_by_booking_id", null)
    .in("booking_status", ["booked", "paid", "reserved"])
    .maybeSingle();
  if (booking.error || !booking.data?.updated_at) {
    return { ok: false, error: booking.error?.message || "COMPANION_SHIFT_SOURCE_BOOKING_NOT_CONFIRMED" };
  }
  const bookingRow = asRecord(booking.data);

  const itineraryResult = await params.supabase
    .from("roamly_itineraries")
    .select("id,full_json,repair_revision")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (itineraryResult.error || !itineraryResult.data) {
    return { ok: false, error: itineraryResult.error?.message || "ITINERARY_NOT_REPAIRABLE" };
  }

  const revision = Number(itineraryResult.data.repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return { ok: false, error: "ITINERARY_NOT_REPAIRABLE" };
  }

  const hash = await params.supabase.rpc("roamly_itinerary_content_hash", {
    value: itineraryResult.data.full_json
  });
  if (hash.error || typeof hash.data !== "string" || !hash.data.trim()) {
    return { ok: false, error: hash.error?.message || "ITINERARY_HASH_UNAVAILABLE" };
  }

  const itinerary = asRecord(itineraryResult.data.full_json);
  const days = asArray(itinerary.daily_itinerary).map(asRecord);
  const timelineEntries = days.flatMap((day) =>
    asArray(day.live_timeline).map((value) => ({ day: asRecord(day), item: asRecord(value) }))
  );

  // Locate the flight item to anchor "downstream".
  const flightEntry = timelineEntries.find(({ item }) => isFlightItem(item, bookingRow));
  const arrivalDate = asString(newBooking.end_at || oldBooking.end_at).slice(0, 10);
  const anchorDayId = flightEntry
    ? asString(flightEntry.day.day_id)
    : asString(days.find((day) => asString(day.date).slice(0, 10) === arrivalDate)?.day_id);
  if (!anchorDayId) {
    return { ok: false, error: "COMPANION_SHIFT_DAY_NOT_FOUND" };
  }

  const oldArrivalMinutes = clockMinutes(asString(oldBooking.end_at));

  const confirmedBookings = await params.supabase
    .from("roamly_bookings")
    .select("title,flight_number,booking_status,traveler_confirmed,superseded_by_booking_id")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .is("superseded_by_booking_id", null);
  const bookingRows = asArray(confirmedBookings.data).map(asRecord).filter((row) => {
    const status = asString(row.booking_status || (row as JsonRecord).status).toLowerCase();
    return row.traveler_confirmed === true || ["confirmed", "booked", "ticketed", "issued"].includes(status);
  });

  const affected = asArray(params.impact.affected_items_json).map(asRecord);
  const shifts: ShiftTarget[] = [];

  for (const candidate of affected) {
    if (shifts.length >= MAX_SHIFT_TARGETS) break;
    const itemId = asString(candidate.item_id);
    const dayId = asString(candidate.day_id);
    if (!itemId || dayId !== anchorDayId) continue;

    const matches = timelineEntries.filter(
      ({ day, item }) => asString(day.day_id) === dayId && asString(item.item_id) === itemId
    );
    if (matches.length !== 1) continue;
    const { item } = matches[0];

    if (flightEntry && item === flightEntry.item) continue;
    if (isFlightItem(item, bookingRow)) continue;

    const status = asString(item.status).toLowerCase();
    const state = asString(item.state).toLowerCase();
    if (BLOCKED_ITEM_STATES.has(status) || BLOCKED_ITEM_STATES.has(state)) continue;

    // Booking-anchored items keep reservation truth; the plan never invents
    // new times for them.
    if ("booking" in item || "anchor_id" in item) continue;
    const title = asString(item.title || item.description);
    if (bookingRows.some((row) => titleMatchesBooking(title, row))) continue;

    const start = itemStart(item);
    if (!start) continue;
    const end = itemEnd(item);

    // Downstream guard: only shift items at/after the old arrival when both
    // clocks parse; otherwise trust the impact analysis's affected list.
    if (oldArrivalMinutes !== null) {
      const itemMinutes = clockMinutes(start.value);
      if (itemMinutes !== null && itemMinutes < oldArrivalMinutes) continue;
    }

    const afterStart = shiftClockValue(start.value, deltaMinutes);
    if (!afterStart) continue;
    const afterEnd = end ? shiftClockValue(end.value, deltaMinutes) : null;
    if (end && !afterEnd) continue;

    shifts.push({
      itemId,
      dayId,
      title: title || "Planned stop",
      startKey: start.key,
      endKey: end ? end.key : null,
      beforeStart: start.value,
      beforeEnd: end ? end.value : null,
      shiftMinutes: deltaMinutes,
      afterStart,
      afterEnd
    });
  }

  if (!shifts.length) {
    return { ok: false, error: "COMPANION_SHIFT_NO_TARGETS" };
  }

  return {
    ok: true,
    context: {
      itineraryId: String(itineraryResult.data.id),
      shiftMinutes: deltaMinutes,
      shifts,
      expectedRevision: revision,
      expectedContentHash: hash.data,
      expectedEventFingerprint: fingerprint,
      expectedSourceBookingUpdatedAt: String(bookingRow.updated_at)
    }
  };
}

export function shiftProposalSummary(params: {
  eventTitle?: unknown;
  shiftMinutes: number;
  targetCount: number;
  requiresApproval: boolean;
}): string {
  const title =
    typeof params.eventTitle === "string" && params.eventTitle.trim()
      ? params.eventTitle.trim()
      : "Travel change";
  const direction = params.shiftMinutes > 0 ? "later" : "earlier";
  const minutes = Math.abs(params.shiftMinutes);
  const planWord = params.targetCount === 1 ? "plan" : "plans";
  if (params.requiresApproval) {
    return `${title}. Roamly prepared shifting ${params.targetCount} downstream ${planWord} ${direction} by ${minutes} min — needs your approval.`;
  }
  return `${title}. Roamly shifted ${params.targetCount} downstream ${planWord} ${direction} by ${minutes} min to match the airline's updated time.`;
}

export function shiftActionRows(params: {
  proposalId: string;
  tripId: string;
  userId: string;
  shifts: ShiftTarget[];
  requiresApproval: boolean;
}): JsonRecord[] {
  return params.shifts.map((shift, index) => ({
    repair_proposal_id: params.proposalId,
    trip_id: params.tripId,
    user_id: params.userId,
    action_type: "SHIFT_ACTIVITY_TIMING",
    action_status: params.requiresApproval ? "awaiting_approval" : "pending",
    before_json: {
      item_id: shift.itemId,
      day_id: shift.dayId,
      title: shift.title,
      start_key: shift.startKey,
      end_key: shift.endKey,
      start: shift.beforeStart,
      end: shift.beforeEnd
    },
    after_json: {
      item_id: shift.itemId,
      day_id: shift.dayId,
      title: shift.title,
      shift_minutes: shift.shiftMinutes,
      new_start: shift.afterStart,
      new_end: shift.afterEnd
    },
    requires_approval: params.requiresApproval,
    idempotency_key: stableKey([
      params.proposalId,
      "SHIFT_ACTIVITY_TIMING",
      index,
      shift.itemId,
      shift.beforeStart,
      shift.afterStart
    ])
  }));
}

export function shiftProposedChanges(shifts: ShiftTarget[], requiresApproval: boolean): JsonRecord[] {
  return shifts.map((shift) => ({
    action_type: "SHIFT_ACTIVITY_TIMING",
    before: {
      item_id: shift.itemId,
      day_id: shift.dayId,
      title: shift.title,
      start_key: shift.startKey,
      end_key: shift.endKey,
      start: shift.beforeStart,
      end: shift.beforeEnd
    },
    after: {
      item_id: shift.itemId,
      day_id: shift.dayId,
      title: shift.title,
      shift_minutes: shift.shiftMinutes,
      new_start: shift.afterStart,
      new_end: shift.afterEnd
    },
    requires_approval: requiresApproval
  }));
}

export type ShiftVerification = "resolved" | "still_affected" | "uncertain";

export async function verifyAppliedShiftTimingRepair(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  repairProposalId: string;
}): Promise<
  | { ok: true; verification: ShiftVerification; proposal: JsonRecord }
  | { ok: false; error: string }
> {
  const proposalResult = await params.supabase
    .from("companion_repair_proposals")
    .select("*")
    .eq("id", params.repairProposalId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (proposalResult.error) return { ok: false, error: proposalResult.error.message };
  if (!proposalResult.data) return { ok: false, error: "REPAIR_PROPOSAL_NOT_FOUND" };
  const proposal = asRecord(proposalResult.data);
  if (proposal.operation !== "SHIFT_ACTIVITY_TIMING" || proposal.status !== "applied") {
    return { ok: false, error: "COMPANION_SHIFT_NOT_APPLIED" };
  }

  const existingTerminal = ["resolved", "still_affected", "uncertain"].includes(
    asString(proposal.verification_status)
  );
  if (existingTerminal && proposal.verified_at) {
    return {
      ok: true,
      verification: asString(proposal.verification_status) as ShiftVerification,
      proposal
    };
  }

  const bundle = await getTripBundle(params.supabase, params.userId, params.tripId);
  const itinerary = bundle.data?.itinerary?.full_json;
  if (!bundle.data || !itinerary) return { ok: false, error: "CANONICAL_ITINERARY_RELOAD_FAILED" };

  const days = asArray(asRecord(itinerary).daily_itinerary).map(asRecord);
  const expectedFingerprint = asString(proposal.expected_event_fingerprint);
  const actions = asArray(proposal.proposed_changes_json).map(asRecord).filter(
    (action) => asString(action.action_type) === "SHIFT_ACTIVITY_TIMING"
  );

  let matched = 0;
  let stillOld = 0;
  for (const action of actions) {
    const before = asRecord(action.before);
    const after = asRecord(action.after);
    const itemId = asString(after.item_id);
    const dayId = asString(after.day_id);
    const startKey = asString(before.start_key);
    const found = days.flatMap((day) =>
      asString(day.day_id) === dayId
        ? asArray(day.live_timeline).map(asRecord).filter((item) => asString(item.item_id) === itemId)
        : []
    );
    if (found.length !== 1) continue;
    const item = found[0];
    if (
      asString(item.retimed_by_event) === expectedFingerprint &&
      asString(item[startKey]) === asString(after.new_start)
    ) {
      matched += 1;
    } else if (asString(item[startKey]) === asString(before.start)) {
      stillOld += 1;
    }
  }

  const verification: ShiftVerification =
    actions.length > 0 && matched === actions.length
      ? "resolved"
      : stillOld > 0
        ? "still_affected"
        : "uncertain";

  const writer = createSupabaseAdminClient() || params.supabase;
  const verifiedAt = new Date().toISOString();
  const saved = await writer
    .from("companion_repair_proposals")
    .update({ verification_status: verification, verified_at: verifiedAt })
    .eq("id", params.repairProposalId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .eq("status", "applied")
    .eq("verification_status", "pending")
    .select("*")
    .maybeSingle();
  if (saved.error) return { ok: false, error: saved.error.message };

  await writer
    .from("companion_events")
    .update({ status: verification === "resolved" ? "resolved" : "processing" })
    .eq("id", asString(proposal.companion_event_id))
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .in("status", ["proposed", "processing"]);

  return {
    ok: true,
    verification,
    proposal: saved.data ? asRecord(saved.data) : { ...proposal, verification_status: verification, verified_at: verifiedAt }
  };
}

/**
 * Apply a SHIFT_ACTIVITY_TIMING proposal via the atomic Postgres RPC, mark its
 * actions completed, and verify the result. Idempotent: the RPC returns
 * already_applied when the proposal was applied before.
 */
export async function applyShiftTimingProposal(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  repairProposalId: string;
}): Promise<
  | { ok: true; verification: ShiftVerification; proposal: JsonRecord }
  | { ok: false; error: string }
> {
  const applied = await params.supabase.rpc("roamly_apply_shift_activity_timing", {
    p_proposal_id: params.repairProposalId,
    p_trip_id: params.tripId
  });

  if (applied.error) {
    return { ok: false, error: applied.error.message };
  }

  const data = asRecord(applied.data);
  if (data.status !== "applied" && data.status !== "already_applied") {
    return { ok: false, error: "SHIFT_REPAIR_NOT_APPLIED" };
  }

  const writer = createSupabaseAdminClient() || params.supabase;
  await writer
    .from("companion_actions")
    .update({
      action_status: "completed",
      completed_at: new Date().toISOString()
    })
    .eq("repair_proposal_id", params.repairProposalId)
    .eq("user_id", params.userId)
    .in("action_status", ["pending", "approved", "applying", "awaiting_approval"]);

  return verifyAppliedShiftTimingRepair({
    supabase: params.supabase,
    userId: params.userId,
    tripId: params.tripId,
    repairProposalId: params.repairProposalId
  });
}
