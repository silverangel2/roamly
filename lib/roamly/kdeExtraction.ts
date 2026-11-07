import { spawn } from "node:child_process";
import type {
  ExtractedBookingField,
  StructuredBookingExtraction
} from "@/lib/roamly/bookingExtraction";
import type { BookingSegmentInput, TripBookingInput } from "@/lib/roamly/bookingWallet";

/*
 * kdeExtraction — Booking Recon's FIRST-PASS extractor
 * (consolidation 2026-11-06; KDE evaluation verdict: ADOPT as
 * first-pass with the LLM kept as fallback).
 *
 * KItinerary (KDE's itinerary extractor, LGPL-2.0-or-later) reads
 * a booking email the way the provider wrote it: schema.org
 * markup the provider itself declared, or one of 241 provider
 * scripts, or a ticket barcode inside a PDF. It emits schema.org
 * JSON-LD with IANA timezones, and where it has no coverage it
 * answers with SILENCE (an empty list) — never an invented
 * booking. That failure mode is what makes deterministic-first
 * safe: a KDE field exists because an extractor located it in
 * the document, so fields carry EVIDENCE (verified: true, an
 * evidence_location naming the extractor source) instead of a
 * model's confidence score.
 *
 * Shape: the CLI is a worker-side subprocess (there is no Node
 * binding; Nextcloud Mail integrates the same way in
 * production). The worker fetches the raw MIME (Gmail format=raw,
 * same gmail.readonly scope), pipes it to the binary, maps the
 * JSON-LD onto StructuredBookingExtraction with
 * extractionMethod "provider_specific" — the slot the type
 * system always had and no code path ever assigned.
 *
 * BINARY PIN (ship-time step, recorded in CONSOLIDATION-REPORT):
 * pin a CURRENT build — distro package `libkitinerary-bin`
 * (Debian 13 ships 26.04.3; the 26.08.2-2 .deb was obtained and
 * inspected during this build) or KDE's static-build recipe.
 * NEVER the January-2024 Nextcloud snapshot (126 extractors vs
 * 241, known field drops). Resolution order here:
 * ROAMLY_KITINERARY_BIN env → `kitinerary-extractor` on PATH.
 * When no binary is present, every function below returns null
 * and Recon behaves exactly as it did before this lane existed.
 *
 * POLICY: the auto-apply gate is UNCHANGED by this module. KDE
 * extractions compete with the deterministic/LLM lanes on
 * overallConfidence like any other lane; what changes is that a
 * KDE confidence is STRUCTURAL (confirmation reference present +
 * start time present = the mail itself declared this booking),
 * not a keyword count or a model's self-score.
 */

export const KDE_SOURCE_TYPE = "kde_provider" as const;
const KDE_RUN_TIMEOUT_MS = 20_000;

type KdeNode = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function node(value: unknown): KdeNode {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as KdeNode) : {};
}
function nodeList(value: unknown): KdeNode[] {
  if (Array.isArray(value)) return value.filter((v): v is KdeNode => Boolean(v) && typeof v === "object");
  if (value && typeof value === "object") return [value as KdeNode];
  return [];
}

/** KDE date-times arrive either as a plain ISO string or as a
 *  QDateTime object carrying the IANA zone explicitly. Returns
 *  the ISO instant (with its declared offset) + the zone. */
function kdeDateTime(value: unknown): { iso: string | null; timezone: string | null } {
  if (typeof value === "string") return { iso: value.trim() || null, timezone: null };
  const dt = node(value);
  const iso = str(dt["@value"]) || null;
  const timezone = str(dt.timezone) || null;
  return { iso, timezone };
}

function kdeField<T>(value: T | null, evidenceLocation: string, present: boolean): ExtractedBookingField<T> {
  return {
    value,
    // Deterministic evidence: the value is what the document
    // declared. Confidence expresses structural completeness of
    // the extraction, not a probability the field is right.
    confidence: present ? 1 : 0,
    source_type: KDE_SOURCE_TYPE,
    evidence_location: evidenceLocation,
    verified: present
  };
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

let versionProbe: { bin: string; version: string } | null = null;

export function kitineraryBinaryPath(): string {
  return (process.env.ROAMLY_KITINERARY_BIN || "").trim() || "kitinerary-extractor";
}

function runBinary(bin: string, args: string[], input: string | null, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: { code: number; stdout: string; stderr: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish(null);
    }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code: code ?? -1, stdout, stderr });
    });
    if (input != null) child.stdin.write(input);
    child.stdin.end();
  });
}

/** The pinned binary's version string, probed once per process.
 *  Null when no binary answers — the lane is simply off. */
export async function kitineraryVersion(): Promise<string | null> {
  const bin = kitineraryBinaryPath();
  if (versionProbe && versionProbe.bin === bin) return versionProbe.version;
  const result = await runBinary(bin, ["--version"], null, 5_000);
  if (!result || result.code !== 0) return null;
  const version = result.stdout.trim();
  versionProbe = { bin, version };
  return version;
}

/** Run the extractor over raw MIME. Returns the JSON-LD
 *  reservation list (possibly empty — KDE's honest silence), or
 *  null when the lane is unavailable (no binary, crash, timeout,
 *  unparseable output). Callers treat null and [] identically:
 *  fall through to the next lane. */
export async function runKitineraryExtractor(
  rawMime: string,
  contextDateIso?: string | null
): Promise<KdeNode[] | null> {
  if (!rawMime) return null;
  const bin = kitineraryBinaryPath();
  const args = contextDateIso ? ["-c", contextDateIso] : [];
  const result = await runBinary(bin, args, rawMime, KDE_RUN_TIMEOUT_MS);
  if (!result || result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is KdeNode => Boolean(v) && typeof v === "object");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* JSON-LD → StructuredBookingExtraction mapper                        */
/* ------------------------------------------------------------------ */

const TYPE_TO_BOOKING_TYPE: Record<string, string> = {
  FlightReservation: "flight",
  LodgingReservation: "hotel",
  TrainReservation: "train",
  RentalCarReservation: "rental_car",
  BusReservation: "bus",
  EventReservation: "activity",
  FoodEstablishmentReservation: "restaurant"
};

function statusOf(reservation: KdeNode): string {
  const raw = str(reservation.reservationStatus);
  if (/cancel/i.test(raw)) return "cancelled";
  if (/confirm/i.test(raw)) return "confirmed";
  return "needs_confirmation";
}

function addressOf(place: KdeNode): string {
  const address = node(place.address);
  const parts = [str(address.streetAddress), str(address.addressLocality), str(address.addressRegion), str(address.postalCode), str(address.addressCountry)]
    .filter(Boolean);
  return parts.join(", ");
}

function geoOf(place: KdeNode): Record<string, unknown> | null {
  const geo = node(place.geo);
  const lat = typeof geo.latitude === "number" ? geo.latitude : null;
  const lon = typeof geo.longitude === "number" ? geo.longitude : null;
  return lat != null && lon != null ? { lat, lon } : null;
}

interface MappedGroup {
  bookingType: string;
  reservations: KdeNode[];
}

/** Group legs of one reservation together (same @type family +
 *  same reservationNumber); a mail can carry several distinct
 *  reservations — the funnel creates one extraction per message,
 *  so the strongest group (one with a reference + a start time)
 *  is mapped and the rest are named in matchReasons. */
function groupReservations(reservations: KdeNode[]): MappedGroup[] {
  const groups = new Map<string, MappedGroup>();
  for (const reservation of reservations) {
    const type = str(reservation["@type"]);
    const bookingType = TYPE_TO_BOOKING_TYPE[type];
    if (!bookingType) continue;
    const key = `${bookingType}|${str(reservation.reservationNumber) || Math.random().toString(36).slice(2)}`;
    const group = groups.get(key) || { bookingType, reservations: [] };
    group.reservations.push(reservation);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function groupScore(group: MappedGroup): number {
  const first = group.reservations[0];
  const hasRef = Boolean(str(first.reservationNumber));
  const hasStart = Boolean(mapGroup(group).startIso);
  return (hasRef ? 2 : 0) + (hasStart ? 1 : 0);
}

function mapGroup(group: MappedGroup): {
  booking: TripBookingInput;
  startIso: string | null;
  endIso: string | null;
  evidence: string;
} {
  const { bookingType, reservations } = group;
  const first = reservations[0];
  const last = reservations[reservations.length - 1];
  const status = statusOf(first);
  const confirmationCode = str(first.reservationNumber) || null;
  const evidence = `kde:${str(first["@type"]).toLowerCase() || "reservation"}`;
  const booking: TripBookingInput = {
    bookingType,
    bookingStatus: status,
    confirmationCode,
    providerBookingId: str(node(first.reservedTicket).ticketNumber) || null,
    metadata: {
      kde_extraction: true,
      kde_reservation_count: reservations.length,
      traveler_name: str(node(first.underName).name) || null
    }
  };
  let startIso: string | null = null;
  let endIso: string | null = null;

  if (bookingType === "flight" || bookingType === "train" || bookingType === "bus") {
    const vehicleKey = bookingType === "flight" ? "Flight" : bookingType === "train" ? "TrainTrip" : "BusTrip";
    const firstLeg = node(first.reservationFor);
    const lastLeg = node(last.reservationFor);
    const carrier = node(firstLeg.airline || firstLeg.provider || firstLeg.operator);
    const segments: BookingSegmentInput[] = reservations.map((leg, i) => {
      const forNode = node(leg.reservationFor);
      const dep = node(forNode.departureAirport || forNode.departureStation);
      const arr = node(forNode.arrivalAirport || forNode.arrivalStation);
      const depTime = kdeDateTime(forNode.departureTime);
      const arrTime = kdeDateTime(forNode.arrivalTime);
      return {
        sequence: i + 1,
        origin: str(dep.iataCode) || str(dep.name) || null,
        destination: str(arr.iataCode) || str(arr.name) || null,
        departureTime: depTime.iso,
        arrivalTime: arrTime.iso,
        provider: str(carrier.name) || null,
        serviceNumber:
          str(forNode.flightNumber) || str(leg.flightNumber) || str(forNode.trainNumber) || null,
        terminal: str(forNode.departureTerminal) || str(leg.departureTerminal) || null,
        gate: str(leg.departureGate) || null,
        seat: str(leg.airplaneSeat) || null,
        status
      };
    });
    const depFirst = node(firstLeg.departureAirport || firstLeg.departureStation);
    const arrLast = node(lastLeg.arrivalAirport || lastLeg.arrivalStation);
    const depTime = kdeDateTime(firstLeg.departureTime);
    const arrTime = kdeDateTime(lastLeg.arrivalTime);
    startIso = depTime.iso;
    endIso = arrTime.iso;
    const serviceNumber = segments[0]?.serviceNumber || null;
    booking.provider = str(carrier.name) || null;
    booking.airlineCode = bookingType === "flight" ? str(carrier.iataCode) || null : null;
    booking.flightNumber = bookingType === "flight" ? serviceNumber : null;
    booking.origin = str(depFirst.iataCode) || str(depFirst.name) || null;
    booking.destination = str(arrLast.iataCode) || str(arrLast.name) || null;
    booking.startTime = startIso;
    booking.endTime = endIso;
    booking.departureTimezone = depTime.timezone;
    booking.arrivalTimezone = arrTime.timezone;
    booking.terminal = segments[0]?.terminal || null;
    booking.gate = segments[0]?.gate || null;
    booking.title =
      bookingType === "flight" && serviceNumber
        ? `Flight ${booking.airlineCode ? `${booking.airlineCode} ` : ""}${serviceNumber}`.trim()
        : `${booking.provider || "Travel"} ${bookingType} booking`;
    booking.segments = segments;
    void vehicleKey;
  } else if (bookingType === "hotel") {
    const place = node(first.reservationFor);
    const checkIn = kdeDateTime(first.checkinTime);
    const checkOut = kdeDateTime(first.checkoutTime);
    startIso = checkIn.iso;
    endIso = checkOut.iso;
    booking.locationName = str(place.name) || null;
    booking.title = booking.locationName ? `${booking.locationName} hotel booking` : "Hotel booking";
    booking.address = addressOf(place) || null;
    booking.coordinates = geoOf(place);
    booking.checkInTime = startIso;
    booking.checkOutTime = endIso;
    booking.startTime = startIso;
    booking.endTime = endIso;
    booking.timezone = checkIn.timezone;
    const price = first.totalPrice;
    if (typeof price === "number" && Number.isFinite(price)) booking.totalPrice = price;
    if (str(first.priceCurrency)) booking.currency = str(first.priceCurrency);
  } else {
    // rental_car / activity / restaurant — the shared reservation
    // skeleton: a place (or pickup location), a start/end.
    const place = node(first.reservationFor);
    const start = kdeDateTime(first.startTime || first.checkinTime || node(first.reservationFor).startTime);
    const end = kdeDateTime(first.endTime || first.checkoutTime || node(first.reservationFor).endTime);
    startIso = start.iso;
    endIso = end.iso;
    booking.locationName = str(place.name) || null;
    booking.title = booking.locationName || `${bookingType} booking`;
    booking.address = addressOf(place) || null;
    booking.coordinates = geoOf(place);
    booking.startTime = startIso;
    booking.endTime = endIso;
    booking.timezone = start.timezone;
    const price = first.totalPrice;
    if (typeof price === "number" && Number.isFinite(price)) booking.totalPrice = price;
    if (str(first.priceCurrency)) booking.currency = str(first.priceCurrency);
  }
  return { booking, startIso, endIso, evidence };
}

/** Map KDE JSON-LD reservations onto Roamly's extraction shape.
 *  Returns null when nothing mappable was extracted (KDE silence
 *  or only unmappable types) — the caller falls through to the
 *  existing lanes unchanged. */
export function mapKdeReservationsToExtraction(
  reservations: KdeNode[]
): StructuredBookingExtraction | null {
  const groups = groupReservations(reservations);
  if (!groups.length) return null;
  groups.sort((a, b) => groupScore(b) - groupScore(a));
  const group = groups[0];
  const { booking, startIso, endIso, evidence } = mapGroup(group);
  const confirmationCode = booking.confirmationCode || null;
  const status = booking.bookingStatus || "needs_confirmation";
  const eventTypes = status === "cancelled" ? ["cancellation"] : [];
  // Structural confidence — the mirror of the deterministic
  // lane's credible-evidence gate, with evidence in place of
  // keyword counts: a reference + a start time means the mail
  // itself declared this booking.
  const overallConfidence = confirmationCode && startIso ? 1 : startIso ? 0.9 : confirmationCode ? 0.85 : 0.7;
  const missingFields = [
    !confirmationCode ? "confirmation_code" : "",
    !startIso && status === "confirmed" ? "start_time" : "",
    group.bookingType === "flight" && !booking.flightNumber ? "flight_number" : ""
  ].filter(Boolean);
  const requiresUserApproval =
    status === "cancelled" || !(status === "confirmed" && Boolean(confirmationCode) && Boolean(startIso));
  const finalStatus =
    overallConfidence >= 0.82 && missingFields.length === 0 && !requiresUserApproval ? status : status === "cancelled" ? "cancelled" : "needs_confirmation";
  booking.bookingStatus = finalStatus;
  const extraGroups = groups.length - 1;
  return {
    booking,
    extractionMethod: "provider_specific",
    overallConfidence,
    missingFields,
    matchReasons: [
      "kde:provider_specific",
      ...(extraGroups > 0 ? [`kde:additional_reservations:${extraGroups}`] : []),
      ...eventTypes.map((event) => `event:${event}`)
    ],
    eventTypes,
    requiresUserApproval,
    fields: {
      booking_type: kdeField(group.bookingType, evidence, true),
      provider: kdeField(booking.provider || null, evidence, Boolean(booking.provider)),
      confirmation_code: kdeField(confirmationCode, evidence, Boolean(confirmationCode)),
      start_time: kdeField(startIso, evidence, Boolean(startIso)),
      end_time: kdeField(endIso, evidence, Boolean(endIso)),
      flight_number: kdeField(booking.flightNumber || null, evidence, Boolean(booking.flightNumber)),
      airline_code: kdeField(booking.airlineCode || null, evidence, Boolean(booking.airlineCode)),
      terminal: kdeField(booking.terminal || null, evidence, Boolean(booking.terminal)),
      gate: kdeField(booking.gate || null, evidence, Boolean(booking.gate)),
      origin: kdeField(booking.origin || null, evidence, Boolean(booking.origin)),
      destination: kdeField(booking.destination || null, evidence, Boolean(booking.destination)),
      title: kdeField(booking.title || null, evidence, Boolean(booking.title))
    }
  };
}

/** The first-pass entry: raw MIME in, extraction (or null) out.
 *  Null covers BOTH "no binary on this host" and "KDE read the
 *  mail and found nothing it covers" — either way the existing
 *  lanes proceed exactly as before. */
export async function kdeExtractionFromRawMime(params: {
  rawMime: string;
  receivedAt?: string | null;
}): Promise<StructuredBookingExtraction | null> {
  const reservations = await runKitineraryExtractor(params.rawMime, params.receivedAt || undefined);
  if (!reservations || !reservations.length) return null;
  return mapKdeReservationsToExtraction(reservations);
}
