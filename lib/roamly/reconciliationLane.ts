/*
 * Build 2 reconciliation POLICY lanes (DESIGN-PRODUCTION.md Phase 8).
 *
 * Policy, not plumbing (audit resolution C4): Gmail ingestion already
 * exists in production (OAuth -> sync/webhook -> travel_email_messages
 * -> extraction -> Attach/Discard). This module is the Build 2 lane
 * policy that runs on top of it:
 *
 *  1. GMAIL ONLY. In the Build 2 flow the one mailbox is Gmail. Any
 *     other provider named in a connect attempt is refused GMAIL_ONLY
 *     (owner, 2026-10-21 19:16 ADT: "and email is only gmail."). The
 *     legacy Outlook stack is NOT deleted or edited — it is gated off
 *     in this flow only, and its sync path never enters this lane.
 *  2. CONSENT BEFORE ANY READ. Reconciliation reads refuse until the
 *     Build 2 consent scope ("booking-confirmations-only-in-gmail",
 *     recorded at connect, Phase 6) exists and the Gmail gate state is
 *     RECONCILIATION_ARMED — a state the Phase 1 DTO parser already
 *     makes structurally impossible without a recorded consent scope.
 *     No Gmail connected -> the plain Gmail-specific refusal message;
 *     nothing is read either way.
 *  3. BOOKING-PATTERN GATE. Only booking-pattern mail (confirmation /
 *     change / cancellation structure) enters extraction. Everything
 *     else is rejected in front of extraction with the reason
 *     recorded — newsletters and general mail are never mined for
 *     itinerary facts (BUILD2-SPEC §1 law).
 *  4. DETERMINISTIC EXTRACTOR = PARSER OF RECORD. Facts come from the
 *     stated fields only, in the canonical Phase 1 BookingFactDTO /
 *     BookingSignalDTO shape. A required field the message does not
 *     state leaves the signal UNRESOLVED — never guessed, never
 *     AI-completed (the model-assisted extraction path stays available
 *     to legacy flows outside this lane only). Conflicting messages
 *     about one booking resolve newest-verified-governs, with the
 *     superseded facts retained in provenance.
 *  5. SILENT vs LOUD (owner law, DESIGN §1.7 — no third lane). Each
 *     verified fact set is classified against the current plan:
 *     SILENT-align when it fits or moves only unprotected items;
 *     LOUD-collision when it conflicts with a protected/timed
 *     commitment or a paid item, with the reason recorded and the
 *     endangered items named. The Updater that consumes this stream
 *     is Phase 9; itinerary-changing effects never apply here.
 *
 * The module is pure policy: no I/O, no clock reads. Callers inject
 * the gate state, the message reader, and the plan view — which is
 * what lets the proof assert that a refused lane performs ZERO
 * message reads.
 */

import {
  EMAIL_REFUSAL_MESSAGE,
  GMAIL_CONSENT_SCOPE,
  GMAIL_ONLY_MESSAGE
} from "@/lib/roamly/gateMachine";
import { build2ReconciliationSilentEnabled } from "@/lib/roamly/build2Flags";
import { bookingSignalId } from "@/lib/roamly/engine/ids";
import {
  instantStringToLocal,
  isValidTimeZone,
  localToInstantString,
  minutesToClock,
  type LocalDate,
  type PlanMinutes
} from "@/lib/roamly/engine/time";
import type {
  BookingFactDTO,
  BookingSignalDTO,
  GateStateDTO,
  GmailGateState,
  StatedDateTimeDTO
} from "@/lib/roamly/engine/types";
import type { TravelEmailMetadata } from "@/lib/roamly/travelEmailFiltering";

export { GMAIL_CONSENT_SCOPE };

/** The one mailbox the Build 2 flow can connect or read. */
export const BUILD2_EMAIL_PROVIDER = "gmail" as const;

/** Minutes allowed to reach a boarding/item after landing (shadow law). */
export const DEFAULT_ARRIVAL_TRANSFER_MINUTES = 40;
/** A hotel check-in occupies a short handling window, not the whole stay. */
export const HOTEL_HANDLING_WINDOW_MINUTES = 30;

/* ------------------------------------------------------------------ */
/* Gmail-only connect surface                                          */
/* ------------------------------------------------------------------ */

export type Build2ConnectDecision =
  | { ok: true; provider: typeof BUILD2_EMAIL_PROVIDER }
  | { ok: false; code: "GMAIL_ONLY"; message: string };

/**
 * The Build 2 connect surface offers Gmail only. Any other provider —
 * Outlook included — is refused in-flow with GMAIL_ONLY; the gate does
 * not move and no OAuth flow starts (same refusal the Phase 6 gate
 * machine returns; this is the reconciliation/settings surface of the
 * same law).
 */
export function attemptBuild2EmailConnect(provider: string): Build2ConnectDecision {
  if (provider === BUILD2_EMAIL_PROVIDER) return { ok: true, provider: BUILD2_EMAIL_PROVIDER };
  return { ok: false, code: "GMAIL_ONLY", message: GMAIL_ONLY_MESSAGE };
}

/**
 * Whether the Build 2 lane governs this connection's mail at all:
 * the silent-lane flag is on (it defaults to the Build 2 umbrella)
 * AND the connection is Gmail. Outlook connections are never in-lane;
 * with the flag off nothing is in-lane and pre-Build-2 behavior rules.
 */
export function build2ReconciliationLaneActive(
  provider: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  return provider === BUILD2_EMAIL_PROVIDER && build2ReconciliationSilentEnabled(env);
}

/* ------------------------------------------------------------------ */
/* Consent gate — no read before an armed, consented Gmail             */
/* ------------------------------------------------------------------ */

export interface ReconciliationGateInput {
  gmailState: GmailGateState;
  /** The consent scope recorded at connect; null until recorded. */
  gmailConsentScope: string | null;
}

export function gateInputFromGateState(gate: GateStateDTO): ReconciliationGateInput {
  return { gmailState: gate.gmailState, gmailConsentScope: gate.gmailConsentScope };
}

export type ReconciliationReadDecision =
  | { ok: true }
  | { ok: false; code: "GMAIL_NOT_CONNECTED"; message: string }
  | { ok: false; code: "RECONCILIATION_NOT_ARMED"; message: string };

const NOT_ARMED_MESSAGE =
  "Roamly has your Gmail connected, but booking-confirmation reading is not armed yet — " +
  "the consent recorded for this trip does not cover it, so nothing has been read.";

/**
 * The read guard every reconciliation entry point runs FIRST.
 * RECONCILIATION_ARMED is reachable only with the Build 2 consent
 * scope recorded (the Phase 1 parser refuses an armed record without
 * one; this guard re-checks defensively, so a hand-built record
 * cannot slip a read past the consent law either).
 */
export function guardReconciliationRead(gate: ReconciliationGateInput): ReconciliationReadDecision {
  if (gate.gmailState === "RECONCILIATION_ARMED") {
    return gate.gmailConsentScope === GMAIL_CONSENT_SCOPE
      ? { ok: true }
      : { ok: false, code: "RECONCILIATION_NOT_ARMED", message: NOT_ARMED_MESSAGE };
  }
  if (gate.gmailState === "CONNECTED" || gate.gmailState === "REAUTH_REQUIRED") {
    return { ok: false, code: "RECONCILIATION_NOT_ARMED", message: NOT_ARMED_MESSAGE };
  }
  // NOT_CONNECTED / ASK / OAUTH_PENDING / DISCONNECTED / REVOKED —
  // the plain Gmail-specific refusal the owner wording prescribes.
  return { ok: false, code: "GMAIL_NOT_CONNECTED", message: EMAIL_REFUSAL_MESSAGE };
}

/* ------------------------------------------------------------------ */
/* Lane messages — one shape for .eml fixtures and Gmail metadata      */
/* ------------------------------------------------------------------ */

export interface LaneMessageInput {
  messageId: string;
  sender: string | null;
  subject: string | null;
  /** The message's Date header (RFC) or received instant (ISO). */
  receivedAt: string | null;
  /** Plain-text body; booking facts ride as "Label: value" lines. */
  bodyText: string;
}

export interface ParsedLaneMessage {
  messageId: string;
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  body: string;
  fields: Record<string, string>;
}

function parseFieldLines(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^([^:\n]{2,48}):\s+(.+)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

export function parseLaneMessage(input: LaneMessageInput): ParsedLaneMessage {
  return {
    messageId: input.messageId,
    sender: input.sender,
    subject: input.subject,
    receivedAt: input.receivedAt,
    body: input.bodyText,
    fields: parseFieldLines(input.bodyText)
  };
}

/** Adapter for raw message text (the shadow .eml fixtures' shape). */
export function laneMessageFromRawEmail(raw: string): LaneMessageInput {
  const normalized = raw.replace(/\r\n/g, "\n");
  const idx = normalized.indexOf("\n\n");
  const head = idx >= 0 ? normalized.slice(0, idx) : "";
  const body = idx >= 0 ? normalized.slice(idx + 2) : normalized;
  const headers: Record<string, string> = {};
  let current: string | null = null;
  for (const line of head.split("\n")) {
    if (/^\s/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      current = m[1].toLowerCase();
      headers[current] = m[2];
    }
  }
  return {
    messageId: headers["message-id"] || "",
    sender: headers.from || null,
    subject: headers.subject || null,
    receivedAt: headers.date || null,
    bodyText: body
  };
}

/** Adapter for the existing pipeline's Gmail metadata + body text. */
export function laneMessageFromMetadata(metadata: TravelEmailMetadata): LaneMessageInput {
  return {
    messageId: metadata.messageId,
    sender: metadata.sender ?? null,
    subject: metadata.subject ?? null,
    receivedAt: metadata.receivedAt ?? null,
    bodyText: metadata.bodyText ?? ""
  };
}

/* ------------------------------------------------------------------ */
/* Booking-pattern gate (in front of extraction)                       */
/* ------------------------------------------------------------------ */

export type BookingPatternDecision =
  | { accepted: true }
  | { accepted: false; reason: string; failedChecks: string[] };

/**
 * The intake classifier, ported from the shadow recon gate: a
 * message is booking-pattern only when it carries the booking
 * skeleton (reference + type), a travel action (booking subject or a
 * stated status), and structured booking times. Rejection reasons
 * name exactly which check failed — the reason is recorded with the
 * rejection, never a bare drop.
 */
export function classifyBookingPattern(parsed: ParsedLaneMessage): BookingPatternDecision {
  const failedChecks: string[] = [];
  const fields = parsed.fields;
  const hasBookingSkeleton = Boolean(fields["Booking reference"] && fields["Booking type"]);
  if (!hasBookingSkeleton) failedChecks.push("booking skeleton (Booking reference + Booking type fields)");
  const subject = parsed.subject || "";
  const hasTravelAction =
    /booking|reservation|flight|hotel|cruise/i.test(subject) ||
    /confirmed|delayed|changed|cancelled/i.test(fields.Status || "");
  if (!hasTravelAction) failedChecks.push("travel action (booking subject or stated status)");
  const hasStructuredTimes = Object.keys(fields).some((k) =>
    /departure|arrival|check-in|check-out|reservation|boarding|start|end/i.test(k)
  );
  if (!hasStructuredTimes) failedChecks.push("structured booking times");
  if (failedChecks.length === 0) return { accepted: true };
  return {
    accepted: false,
    failedChecks,
    reason:
      `not a booking-pattern message (missing ${failedChecks.join("; ")}) — ` +
      "general mail is outside the reconciliation lane"
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic extractor — the parser of record                      */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A stated date/time, verbatim: "Friday, October 23, 2026 at 1:20 PM
 * (America/Halifax)". The stated timezone string is provenance (the
 * Phase 1 contract) — conversion is the time adapter's job, done by
 * the lane classifier against the trip's IANA zone.
 */
export function parseStatedDateTime(value: string | null | undefined): StatedDateTimeDTO | null {
  if (!value) return null;
  const m = String(value).match(
    /(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+\(([^)]+)\)/i
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  let hour = Number(m[4]);
  const meridiem = m[6].toUpperCase();
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  const minute = Number(m[5]);
  return {
    date: `${m[3]}-${month}-${pad2(Number(m[2]))}`,
    time: `${pad2(hour)}:${m[5]}`,
    minutes: hour * 60 + minute,
    timeZone: m[7],
    stated: value
  };
}

function parsePrice(value: string | null | undefined): BookingFactDTO["price"] {
  if (!value) return { amount: null, currency: null, status: "UNKNOWN" };
  const m = String(value).match(/([A-Z]{3})\s+([0-9]+(?:\.[0-9]{2})?)/);
  return m
    ? { amount: Number(m[2]), currency: m[1], status: "booked" }
    : { amount: null, currency: null, status: "UNKNOWN" };
}

/**
 * The canonical fact: BookingFactDTO plus the kind-specific stated
 * fields the Phase 1 golden fixtures carry (boarding/prepaid for
 * activities, stars/room for hotels, party size for restaurants).
 * Fields a message does not state stay absent/null — never invented.
 */
export interface ReconciliationBookingFact extends BookingFactDTO {
  boarding?: StatedDateTimeDTO | null;
  prepaid?: boolean | null;
  stars?: number | null;
  room?: string | null;
  partySize?: number | null;
}

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  flight: ["provider", "reference", "leadTraveler", "status", "flight", "from", "to", "start", "end"],
  hotel: ["provider", "reference", "leadTraveler", "status", "name", "address", "start", "end"],
  restaurant: ["provider", "reference", "leadTraveler", "status", "name", "address", "start", "end"],
  activity: ["provider", "reference", "leadTraveler", "status", "name", "address", "start", "end"]
};
const DEFAULT_REQUIRED_FIELDS: readonly string[] = ["provider", "reference", "status", "start", "end"];

function normalizeBooking(fields: Record<string, string>): ReconciliationBookingFact {
  const kind = String(fields["Booking type"] || "").toLowerCase();
  const fact: ReconciliationBookingFact = {
    kind,
    provider: fields.Provider || null,
    reference: fields["Booking reference"] || null,
    leadTraveler: fields["Lead traveler"] || null,
    status: String(fields.Status || "").toLowerCase() || null,
    price: parsePrice(fields.Price),
    name: null,
    place: null,
    address: null,
    flight: null,
    from: null,
    to: null,
    start: null,
    end: null
  };
  if (kind === "flight") {
    const to = fields.To || null;
    fact.flight = fields.Flight || null;
    fact.from = fields.From || null;
    fact.to = to;
    fact.name = fields.Flight
      ? `Flight ${fields.Flight} to ${String(fields.To || "").replace(/\s*\([A-Z]{3}\)\s*$/, "")}`
      : null;
    fact.place = to;
    fact.address = to;
    fact.start = parseStatedDateTime(fields["Updated departure"] || fields.Departure);
    fact.end = parseStatedDateTime(fields["Updated arrival"] || fields.Arrival);
    return fact;
  }
  if (kind === "hotel") {
    fact.name = fields.Hotel || null;
    fact.place = fields.Hotel || null;
    fact.address = fields.Address || null;
    fact.stars = fields["Star rating"] ? Number(fields["Star rating"]) : null;
    fact.room = fields.Room || null;
    fact.start = parseStatedDateTime(fields["Check-in"]);
    fact.end = parseStatedDateTime(fields["Check-out"]);
    return fact;
  }
  if (kind === "restaurant") {
    fact.name = fields.Place || null;
    fact.place = fields.Place || null;
    fact.address = fields.Address || null;
    fact.partySize = fields["Party size"] ? Number(fields["Party size"]) : null;
    fact.start = parseStatedDateTime(fields["Reservation start"]);
    fact.end = parseStatedDateTime(fields["Reservation end"]);
    return fact;
  }
  if (kind === "activity") {
    fact.name = fields.Place || null;
    fact.place = fields.Place || null;
    fact.address = fields.Address || null;
    fact.boarding = parseStatedDateTime(fields.Boarding);
    fact.prepaid = /^yes$/i.test(fields.Prepaid || "") || null;
    fact.start = parseStatedDateTime(fields.Start);
    fact.end = parseStatedDateTime(fields.End);
    return fact;
  }
  fact.name = fields.Place || fields.Hotel || null;
  fact.place = fields.Place || fields.Hotel || null;
  fact.address = fields.Address || null;
  fact.start = parseStatedDateTime(fields.Start || fields["Reservation start"] || fields["Check-in"]);
  fact.end = parseStatedDateTime(fields.End || fields["Reservation end"] || fields["Check-out"]);
  return fact;
}

export type LaneMessageOutcome =
  | { classification: "ignored"; messageId: string; subject: string | null; reason: string }
  | { classification: "signal" | "unresolved"; signal: BookingSignalDTO };

/**
 * One message through the gate + extractor. Booking-pattern failures
 * come back "ignored" with the recorded rejection reason; verified
 * facts come back as a canonical BookingSignalDTO whose ID is the
 * Phase 1 recon- content ID; a booking missing a required stated
 * field comes back "unresolved" with the missing fields named.
 */
export function reconcileLaneMessage(input: LaneMessageInput): LaneMessageOutcome {
  const parsed = parseLaneMessage(input);
  const pattern = classifyBookingPattern(parsed);
  if (!pattern.accepted) {
    return {
      classification: "ignored",
      messageId: parsed.messageId,
      subject: parsed.subject,
      reason: pattern.reason
    };
  }
  const booking = normalizeBooking(parsed.fields);
  const required = REQUIRED_FIELDS[booking.kind] || DEFAULT_REQUIRED_FIELDS;
  const missingFields = required.filter((fieldName) => {
    const value = (booking as unknown as Record<string, unknown>)[fieldName];
    return value === null || value === undefined || value === "";
  });
  const signal: BookingSignalDTO = {
    signalId: bookingSignalId({
      messageId: parsed.messageId,
      reference: booking.reference,
      status: booking.status,
      start: booking.start,
      end: booking.end
    }),
    classification: missingFields.length ? "unresolved" : "signal",
    booking,
    missingFields,
    provenance: {
      source: "gmail",
      sourceRef: parsed.messageId,
      recordedAt: parsed.receivedAt,
      label: "booking-email",
      messageId: parsed.messageId
    }
  };
  return { classification: signal.classification, signal };
}

/* ------------------------------------------------------------------ */
/* Supersession — newest verified governs, superseded retained         */
/* ------------------------------------------------------------------ */

export interface SupersessionResult {
  /** The governing verified signals, in received order. */
  governing: BookingSignalDTO[];
  /** Superseded facts, keyed by the governing signal's ID. */
  supersededFactsBySignalId: Record<string, BookingFactDTO[]>;
}

function receivedOrder(signal: BookingSignalDTO): number {
  const parsed = Date.parse(signal.provenance.recordedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Two messages about the same booking (same kind + booking
 * reference): the newest verified fact governs; the older fact is
 * retained on the governing signal's record (provenance), never
 * silently dropped. Unresolved signals never supersede anything.
 */
export function resolveSupersededSignals(signals: BookingSignalDTO[]): SupersessionResult {
  const verified = signals.filter((s) => s.classification === "signal");
  const groups = new Map<string, BookingSignalDTO[]>();
  for (const signal of verified) {
    const key = signal.booking.reference
      ? `${signal.booking.kind}|${signal.booking.reference}`
      : `message|${signal.provenance.messageId}`;
    const group = groups.get(key) || [];
    group.push(signal);
    groups.set(key, group);
  }
  const governing: BookingSignalDTO[] = [];
  const supersededFactsBySignalId: Record<string, BookingFactDTO[]> = {};
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => receivedOrder(a) - receivedOrder(b));
    const winner = ordered[ordered.length - 1];
    governing.push(winner);
    if (ordered.length > 1) {
      supersededFactsBySignalId[winner.signalId] = ordered.slice(0, -1).map((s) => s.booking);
    }
  }
  governing.sort((a, b) => receivedOrder(a) - receivedOrder(b));
  return { governing, supersededFactsBySignalId };
}

/* ------------------------------------------------------------------ */
/* Lane classifier — SILENT for alignment, LOUD for costly collisions  */
/* ------------------------------------------------------------------ */

export interface ReconciliationPlanItem {
  itemRef: string;
  title: string;
  kind: string; // flight | hotel | transfer | food | cruise | activity | ...
  date: LocalDate;
  startMin: PlanMinutes;
  endMin: PlanMinutes;
  boardingMin: PlanMinutes | null; // prepaid boarding moment, when the item has one
  arrivalTransferMin: number | null; // minutes from the arrival area to this item
  paid: boolean;
  prepaid: boolean;
  bookingRef: string | null;
}

export interface ReconciliationPlanView {
  tripId: string;
  timeZone: string; // the trip's IANA zone — plan minutes live here
  items: ReconciliationPlanItem[];
}

export type LaneConflictKind =
  | "starts-before-landing"
  | "cannot-reach-boarding"
  | "overlaps-commitment"
  | "cancels-paid-commitment";

export interface LaneConflict {
  itemRef: string;
  itemName: string;
  kind: LaneConflictKind;
  detail: string;
}

export interface DisplacedPlanItem {
  itemRef: string;
  itemName: string;
  detail: string;
}

export interface LaneClassification {
  lane: "silent" | "loud";
  reason: string;
  conflicts: LaneConflict[];
  displaced: DisplacedPlanItem[];
}

export interface ClassifiedBookingSignal {
  signal: BookingSignalDTO;
  lane: "silent" | "loud";
  reason: string;
  conflicts: LaneConflict[];
  displaced: DisplacedPlanItem[];
  /** Older verified facts this signal superseded (provenance). */
  supersededFacts: BookingFactDTO[];
}

function isCommitment(item: ReconciliationPlanItem): boolean {
  return item.paid || item.prepaid || item.bookingRef !== null;
}

/** Stated time -> trip-local (date, minutes) via the Phase 1 adapter. */
function toTripLocal(
  stated: StatedDateTimeDTO | null,
  tripTimeZone: string
): { date: LocalDate; minutes: PlanMinutes } | null {
  if (!stated || !isValidTimeZone(stated.timeZone) || !isValidTimeZone(tripTimeZone)) return null;
  try {
    const instant = localToInstantString(stated.date, stated.minutes, stated.timeZone);
    const local = instantStringToLocal(instant, tripTimeZone);
    return { date: local.date, minutes: local.minutes };
  } catch {
    return null;
  }
}

/**
 * Classify one verified signal against the current plan. The fact's
 * own plan item (same booking reference) is its subject, never its
 * conflict. A flight fact endangers the arrival day: commitments
 * that start before the flight lands, and prepaid boardings the
 * traveler cannot reach in time. Any other fact endangers the
 * commitments its stated window overlaps. Unbooked items the fact
 * pushes around are recorded as displaced — they are exactly what
 * "moves only unprotected items" means, and they keep the lane
 * silent.
 */
export function classifySignalLane(
  signal: BookingSignalDTO,
  plan: ReconciliationPlanView
): LaneClassification {
  const booking = signal.booking;
  const conflicts: LaneConflict[] = [];
  const displaced: DisplacedPlanItem[] = [];
  const subject =
    plan.items.find((item) => item.bookingRef !== null && item.bookingRef === booking.reference) ||
    null;

  const silent = (note?: string): LaneClassification => ({
    lane: "silent",
    reason:
      "silent-align: the verified booking facts fit the plan — no protected or paid commitment is endangered" +
      (displaced.length
        ? `; ${displaced.length} unbooked item(s) can move with the fact`
        : "") +
      (note ? `; ${note}` : ""),
    conflicts,
    displaced
  });
  const loud = (): LaneClassification => ({
    lane: "loud",
    reason: `loud-collision: ${conflicts.map((c) => c.detail).join(" ")}`,
    conflicts,
    displaced
  });

  // A cancellation of a paid/prepaid booked commitment collides with
  // the plan by definition: the plan counts on the thing cancelled.
  if (booking.status === "cancelled") {
    if (subject && isCommitment(subject)) {
      conflicts.push({
        itemRef: subject.itemRef,
        itemName: subject.title,
        kind: "cancels-paid-commitment",
        detail: `${subject.title} is cancelled in the booking email, but the plan holds it as a paid commitment.`
      });
      return loud();
    }
    return silent("the cancellation touches no paid or booked commitment in the plan");
  }

  const startLocal = toTripLocal(booking.start, plan.timeZone);
  const endLocal = toTripLocal(booking.end, plan.timeZone);
  if (!startLocal || !endLocal) {
    // Timing cannot be placed on the trip's clock (an unstated or
    // unresolvable stated timezone). If the fact changes the subject
    // item's stated times, alignment is unprovable -> loud, plainly.
    // A fact that changes nothing temporal aligns silently.
    const changesSubjectTimes =
      subject !== null &&
      booking.start !== null &&
      (booking.start.minutes !== subject.startMin || booking.start.date !== subject.date);
    if (changesSubjectTimes) {
      conflicts.push({
        itemRef: subject.itemRef,
        itemName: subject.title,
        kind: "overlaps-commitment",
        detail: `${subject.title} has new stated times that cannot be placed on the trip clock (stated timezone unresolved), so alignment cannot be verified.`
      });
      return loud();
    }
    return silent("the fact carries no verifiable timing change");
  }

  if (booking.kind === "flight") {
    const arrival = endLocal;
    for (const item of plan.items) {
      if (item.date !== arrival.date) continue;
      if (subject && item.itemRef === subject.itemRef) continue;
      // The arrival transfer is logistics tied to the flight fact and
      // the hotel is the day's base — neither is an appointment the
      // flight can endanger (shadow collision law).
      if (item.kind === "transfer" || item.kind === "hotel") continue;
      if (item.startMin < arrival.minutes) {
        if (isCommitment(item)) {
          conflicts.push({
            itemRef: item.itemRef,
            itemName: item.title,
            kind: "starts-before-landing",
            detail: `${item.title} starts at ${minutesToClock(item.startMin)}, before the flight lands at ${minutesToClock(arrival.minutes)}.`
          });
        } else {
          displaced.push({
            itemRef: item.itemRef,
            itemName: item.title,
            detail: `${item.title} starts at ${minutesToClock(item.startMin)}, before the flight lands at ${minutesToClock(arrival.minutes)} — unbooked, so it can move.`
          });
        }
        continue;
      }
      if (item.boardingMin !== null) {
        const transferMin = item.arrivalTransferMin ?? DEFAULT_ARRIVAL_TRANSFER_MINUTES;
        const earliestArrival = arrival.minutes + transferMin;
        if (earliestArrival > item.boardingMin) {
          conflicts.push({
            itemRef: item.itemRef,
            itemName: item.title,
            kind: "cannot-reach-boarding",
            detail:
              `${item.title} boards at ${minutesToClock(item.boardingMin)}; with a ${transferMin}-minute transfer, ` +
              `the earliest arrival is ${minutesToClock(earliestArrival)}, after boarding.`
          });
        }
      }
    }
    return conflicts.length ? loud() : silent();
  }

  // Non-flight facts: the stated window (a hotel check-in occupies
  // its handling window, not the whole stay) must not overlap another
  // commitment on the same day.
  const factStartMin = startLocal.minutes;
  const factEndMin =
    booking.kind === "hotel"
      ? Math.min(startLocal.minutes + HOTEL_HANDLING_WINDOW_MINUTES, 1440)
      : endLocal.date === startLocal.date
        ? endLocal.minutes
        : 1440;
  for (const item of plan.items) {
    if (item.date !== startLocal.date) continue;
    if (subject && item.itemRef === subject.itemRef) continue;
    if (item.kind === "transfer") continue;
    const overlaps = factStartMin < item.endMin && item.startMin < factEndMin;
    if (!overlaps) continue;
    if (isCommitment(item)) {
      conflicts.push({
        itemRef: item.itemRef,
        itemName: item.title,
        kind: "overlaps-commitment",
        detail: `${item.title} (${minutesToClock(item.startMin)}–${minutesToClock(item.endMin)}) overlaps the verified ${booking.kind} time (${minutesToClock(factStartMin)}–${minutesToClock(factEndMin)}).`
      });
    } else {
      displaced.push({
        itemRef: item.itemRef,
        itemName: item.title,
        detail: `${item.title} overlaps the verified ${booking.kind} time — unbooked, so it can move.`
      });
    }
  }
  return conflicts.length ? loud() : silent();
}

/* ------------------------------------------------------------------ */
/* The lane run — guard first, then gate -> extract -> supersede ->    */
/* classify. The reader is injected so a refusal provably reads ZERO   */
/* messages.                                                           */
/* ------------------------------------------------------------------ */

export interface ReconciliationLaneRun {
  refusal: (ReconciliationReadDecision & { ok: false }) | null;
  messagesRead: number;
  signals: ClassifiedBookingSignal[];
  unresolved: BookingSignalDTO[];
  ignored: { messageId: string; subject: string | null; reason: string }[];
}

export function runReconciliationLane(params: {
  gate: ReconciliationGateInput;
  readMessages: () => LaneMessageInput[];
  plan: ReconciliationPlanView;
}): ReconciliationLaneRun {
  const decision = guardReconciliationRead(params.gate);
  if (!decision.ok) {
    return { refusal: decision, messagesRead: 0, signals: [], unresolved: [], ignored: [] };
  }
  const messages = params.readMessages();
  const signals: BookingSignalDTO[] = [];
  const unresolved: BookingSignalDTO[] = [];
  const ignored: ReconciliationLaneRun["ignored"] = [];
  for (const message of messages) {
    const outcome = reconcileLaneMessage(message);
    if (outcome.classification === "ignored") {
      ignored.push({ messageId: outcome.messageId, subject: outcome.subject, reason: outcome.reason });
    } else if (outcome.classification === "unresolved") {
      unresolved.push(outcome.signal);
    } else {
      signals.push(outcome.signal);
    }
  }
  const { governing, supersededFactsBySignalId } = resolveSupersededSignals(signals);
  const classified = governing.map((signal) => {
    const classification = classifySignalLane(signal, params.plan);
    return {
      signal,
      lane: classification.lane,
      reason: classification.reason,
      conflicts: classification.conflicts,
      displaced: classification.displaced,
      supersededFacts: supersededFactsBySignalId[signal.signalId] || []
    } satisfies ClassifiedBookingSignal;
  });
  return { refusal: null, messagesRead: messages.length, signals: classified, unresolved, ignored };
}
