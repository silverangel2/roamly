import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPreviewFromItinerary,
  type RoamlyActivitySeed,
  type RoamlyItinerary
} from "@/lib/itinerary";
import { validateItineraryDeterministically } from "@/lib/roamly/itineraryValidation";
import { isOperationalCurrentBooking } from "@/lib/roamly/bookingSupersession";
import {
  bookingDisplayLabel,
  bookingTruthState,
  isConfirmed as bookingTruthIsConfirmed,
  stripBookingStampPrefix,
  titleForTruth,
  type BookingTruthState
} from "@/lib/roamly/bookingTruth";
import { evaluateRouteTransition, type RouteEndpoint, type RouteEvidence } from "@/lib/roamly/itineraryRouting";
import type { TripPlannerPayload } from "@/lib/trip-planner";

type BookingOverrideRecord = {
  id?: string | null;
  timezone?: string | null;
  metadata?: Record<string, unknown> | null;
  superseded_by_booking_id?: string | null;
  recommendation_id?: string | null;
  booking_type?: string | null;
  booking_status?: string | null;
  provider?: string | null;
  provider_name?: string | null;
  title?: string | null;
  confirmation_number?: string | null;
  start_time?: string | null;
  start_at?: string | null;
  end_time?: string | null;
  end_at?: string | null;
  origin?: string | null;
  destination?: string | null;
  location_name?: string | null;
  address?: string | null;
  coordinates?: Record<string, unknown> | null;
  location_id?: string | null;
  flight_number?: string | null;
  terminal?: string | null;
  gate?: string | null;
  reservation_requirements?: Record<string, unknown> | null;
  traveler_confirmed?: boolean | null;
  source_type?: string | null;
  sourceType?: string | null;
  source_reference?: string | null;
  sourceReference?: string | null;
  provider_booking_id?: string | null;
  is_test_booking?: boolean | null;
  is_discarded?: boolean | null;
  booking_segments?: Array<Record<string, unknown>> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseDate(value?: string | null) {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isoDate(value?: string | null) {
  return clean(value).slice(0, 10);
}

function minutesFromDate(value?: string | null, timeZone?: string | null) {
  const date = parseDate(value);
  if (!date) return null;
  if (timeZone) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
      return Number(p.hour) * 60 + Number(p.minute);
    } catch { return null; }
  }
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function minutesBetweenDates(startValue?: string | null, endValue?: string | null) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return minutes > 0 ? minutes : null;
}

function formatTime24(totalMinutes: number) {
  const minutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatTimeLabel(totalMinutes: number) {
  const minutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hour24 = Math.floor(minutes / 60);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes % 60).padStart(2, "0")} ${period}`;
}

function durationMinutes(item: RoamlyActivitySeed) {
  if (typeof item.durationMinutes === "number" && Number.isFinite(item.durationMinutes) && item.durationMinutes > 0) {
    return Math.round(item.durationMinutes);
  }
  if (typeof item.travelTimeMinutes === "number" && Number.isFinite(item.travelTimeMinutes) && item.travelTimeMinutes > 0) {
    return Math.round(item.travelTimeMinutes);
  }
  const text = clean(item.duration).toLowerCase();
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(hr|hour|hours|min|minute|minutes)/);
  if (range) {
    const average = (Number(range[1]) + Number(range[2])) / 2;
    return Math.round(range[3].startsWith("h") ? average * 60 : average);
  }
  const single = text.match(/(\d+(?:\.\d+)?)\s*(hr|hour|hours|min|minute|minutes)/);
  if (single) return Math.round(single[2].startsWith("h") ? Number(single[1]) * 60 : Number(single[1]));
  const type = itemType(item);
  if (type === "transfer") return 45;
  if (type === "hotel") return 75;
  if (type === "meal") return 75;
  if (type === "rest") return 60;
  if (type === "reminder") return 30;
  return 90;
}

function itemType(item: RoamlyActivitySeed) {
  const explicit = clean(item.item_type);
  if (explicit) return explicit;
  const text = `${item.category} ${item.title} ${item.description}`.toLowerCase();
  if (/\bhotel|check[- ]?in|check[- ]?out|luggage|bags?\b/.test(text)) return "hotel";
  if (/\btransfer|taxi|rideshare|shuttle|transit\b/.test(text)) return "transfer";
  if (/\bflight|airport|depart|arrival|arrive|travel|journey|terminal|gate\b/.test(text)) return "travel";
  if (/\blunch|dinner|breakfast|meal|restaurant|cafe\b/.test(text)) return "meal";
  if (/\brest|buffer|recover|security|customs|immigration\b/.test(text)) return "rest";
  if (/\breminder|documents?|baggage\b/.test(text)) return "reminder";
  return "activity";
}

function retime(item: RoamlyActivitySeed, start: number, duration: number) {
  const end = Math.min(23 * 60 + 59, Math.max(start + 1, start + duration));
  return {
    ...item,
    time_label: formatTimeLabel(start),
    startTime: formatTime24(start),
    endTime: formatTime24(end),
    durationMinutes: end - start
  };
}

function firstSegment(booking: BookingOverrideRecord) {
  return Array.isArray(booking.booking_segments) ? record(booking.booking_segments[0]) : {};
}

function bookingStart(booking: BookingOverrideRecord) {
  return clean(booking.start_time || booking.start_at || firstSegment(booking).departure_time);
}

function bookingEnd(booking: BookingOverrideRecord) {
  return clean(booking.end_time || booking.end_at || firstSegment(booking).arrival_time);
}

function bookingIsUsableFlight(booking: BookingOverrideRecord) {
  const type = clean(booking.booking_type).toLowerCase();
  return type === "flight" && Boolean(bookingStart(booking)) && bookingIsConfirmed(booking);
}

/**
 * Workstream A + Round 2 Lane E2: stamping derives from the ONE
 * booking-truth rule (lib/roamly/bookingTruth). "Confirmed:" requires
 * the providerConfirmationEvidence tier (credible provider evidence incl. a
 * RECORDED provider-issued origin + traveler_confirmed + active
 * status + non-test). A travelerConfirmedOnly booking stamps
 * "Confirmed by you:" and never earns verified factual status.
 * Cancelled is handled as its own truth state below — it stamps
 * "Cancelled:", never "Confirmed:", and never verified.
 */
function bookingTruthInput(booking: BookingOverrideRecord) {
  return {
    booking_status: booking.booking_status,
    traveler_confirmed: booking.traveler_confirmed,
    confirmation_number: booking.confirmation_number,
    provider_booking_id: booking.provider_booking_id,
    provider_name: booking.provider_name || booking.provider,
    title: booking.title,
    source_type: booking.source_type || booking.sourceType,
    source_reference: booking.source_reference || booking.sourceReference,
    superseded_by_booking_id: booking.superseded_by_booking_id,
    metadata: booking.metadata,
    is_test_booking: booking.is_test_booking === true,
    is_discarded: booking.is_discarded === true,
    reservation_requirements: booking.reservation_requirements
  };
}

function bookingTruth(booking: BookingOverrideRecord): BookingTruthState {
  return bookingTruthState(bookingTruthInput(booking));
}

function bookingIsConfirmed(booking: BookingOverrideRecord) {
  return Boolean(booking.id) && bookingTruthIsConfirmed(bookingTruthInput(booking));
}

/** Round 3 (Lane T): the provenance-aware display label for the
 *  confirmation-evidence tier ("Confirmed · from your {Provider}
 *  email" etc.) — the only confirmed framing a stamp may carry. */
function bookingProvenanceDisplayLabel(booking: BookingOverrideRecord) {
  return bookingDisplayLabel(bookingTruthInput(booking));
}

/** States that re-stamp a stored item: confirmed (the verified
 *  "Confirmed:" stamp — providerVerified ONLY, owner ruling
 *  2026-10-30), traveler_confirmed (the honest "Confirmed by you:"
 *  stamp), and cancelled/refunded (honest neutral stamp). Test
 *  bookings never stamp; every other state leaves stored items
 *  untouched here — the read path
 *  (reconcileItineraryItemsWithCurrentBookings) strips any stale
 *  confirmed framing for them at render. */
function bookingStampsItinerary(booking: BookingOverrideRecord) {
  const state = bookingTruth(booking);
  // Tombstone (2026-10-31): "discarded" also re-stamps — the discard
  // path calls the same stored-override writer as cancel does, so a
  // stored "Confirmed:" item for a removed import is neutralised at
  // write time too (the read path covers rows this never reaches).
  return Boolean(booking.id) && (state === "confirmed" || state === "traveler_confirmed" || state === "cancelled" || state === "refunded" || state === "discarded");
}

function bookingIsCurrent(booking: BookingOverrideRecord) {
  return isOperationalCurrentBooking(booking);
}

function bookingDate(booking: BookingOverrideRecord) {
  const value = bookingStart(booking) || booking.end_time || booking.end_at;
  const zone = clean(booking.timezone || booking.metadata?.timezone);
  const date = parseDate(value);
  if (zone && date) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
    catch { return ""; }
  }
  return isoDate(value);
}

type TimelineRecord = RoamlyActivitySeed & Record<string, unknown>;

function timelineRecord(item: RoamlyActivitySeed) {
  return item as TimelineRecord;
}

function timelineItemId(item: RoamlyActivitySeed, dayNumber: number, index: number) {
  const value = timelineRecord(item);
  return clean(value.item_id) || clean(value.booking_id) || `day-${dayNumber}-item-${index}`;
}

function coordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function endpointForItem(item: RoamlyActivitySeed, itemId: string): RouteEndpoint {
  const value = timelineRecord(item);
  const coordinates = value.coordinates && typeof value.coordinates === "object" && !Array.isArray(value.coordinates)
    ? value.coordinates as Record<string, unknown>
    : {};
  return {
    itemId,
    locationId: clean(value.location_id) || null,
    latitude: coordinate(coordinates.latitude ?? coordinates.lat ?? value.latitude),
    longitude: coordinate(coordinates.longitude ?? coordinates.lng ?? coordinates.lon ?? value.longitude),
    locationSource: clean(value.location_source) || null,
    provenance: clean(value.factualStatus) || null
  };
}

function routeEvidenceFor(value: unknown, fromItemId: string, toItemId: string): RouteEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evidence = value as Partial<RouteEvidence>;
  return evidence.fromItemId === fromItemId && evidence.toItemId === toItemId
    ? evidence as RouteEvidence
    : null;
}

function clockMinutes(value: unknown) {
  const raw = clean(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
}

function absoluteItemMinutes(item: RoamlyActivitySeed, dayIndex: number, key: "startTime" | "endTime") {
  const value = clockMinutes(timelineRecord(item)[key]);
  return value == null ? null : dayIndex * 24 * 60 + value;
}

function isTransitionItem(item: RoamlyActivitySeed) {
  const value = timelineRecord(item);
  return item.item_type === "travel" || item.item_type === "transfer" || item.plan_role === "protected_anchor" || value.route_evidence != null || value.routing_status != null;
}

function routeUncertainty(value: TimelineRecord) {
  const messages = Array.isArray(value.uncertainty) ? value.uncertainty.filter((entry): entry is string => typeof entry === "string") : [];
  return Array.from(new Set([...messages, "Route evidence must be revalidated after the confirmed booking change."])).slice(0, 8);
}

function coordinatePair(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as Record<string, unknown>;
  const latitude = coordinate(point.latitude ?? point.lat);
  const longitude = coordinate(point.longitude ?? point.lng ?? point.lon);
  return latitude == null || longitude == null ? null : `${latitude},${longitude}`;
}

function bookingFactsChanged(itinerary: RoamlyItinerary, booking: BookingOverrideRecord) {
  const bookingId = clean(booking.id);
  const recommendationId = clean(booking.recommendation_id);
  const existing = itinerary.daily_itinerary.flatMap((day) => day.live_timeline || []).find((item) => {
    const value = timelineRecord(item);
    return clean(value.booking_id) === bookingId || (recommendationId && clean(value.candidateId) === recommendationId);
  });
  if (!existing) return true;
  const value = timelineRecord(existing);
  const bookingLocation = clean(booking.location_name || booking.address || booking.destination || booking.origin);
  const existingLocation = clean(value.location_name);
  if (bookingLocation && bookingLocation !== existingLocation) return true;
  const bookingCoordinates = coordinatePair(booking.coordinates);
  const existingCoordinates = coordinatePair(value.coordinates);
  if (bookingCoordinates && bookingCoordinates !== existingCoordinates) return true;
  const bookingOrigin = clean(booking.origin || firstSegment(booking).origin);
  const bookingDestination = clean(booking.destination || firstSegment(booking).destination);
  if (bookingOrigin && bookingOrigin !== clean(value.origin)) return true;
  if (bookingDestination && bookingDestination !== clean(value.destination)) return true;
  const bookingStartMinutes = minutesFromDate(bookingStart(booking));
  const existingStartMinutes = clockMinutes(value.startTime);
  if (bookingStartMinutes != null && bookingStartMinutes !== existingStartMinutes) return true;
  const bookingEndMinutes = minutesFromDate(bookingEnd(booking));
  const existingEndMinutes = clockMinutes(value.endTime);
  return bookingEndMinutes != null && bookingEndMinutes !== existingEndMinutes;
}

function reconcileAffectedBookingRouting(itinerary: RoamlyItinerary, booking: BookingOverrideRecord, forceInvalidate = false) {
  const flattened = itinerary.daily_itinerary.flatMap((day, dayIndex) =>
    (day.live_timeline || []).map((item, itemIndex) => ({ day, dayIndex, itemIndex, item }))
  );
  const bookingId = clean(booking.id);
  const anchorIndex = flattened.findIndex(({ item }) => clean(timelineRecord(item).booking_id) === bookingId);
  if (!bookingId || anchorIndex < 0) return { itinerary, changed: false };

  const anchor = flattened[anchorIndex];
  const pairs = [
    anchorIndex > 0
      ? {
          from: flattened[anchorIndex - 1],
          to: anchor,
          holder: isTransitionItem(flattened[anchorIndex - 1].item) ? flattened[anchorIndex - 1] : anchor
        }
      : null,
    anchorIndex + 1 < flattened.length
      ? {
          from: anchor,
          to: flattened[anchorIndex + 1],
          holder: isTransitionItem(flattened[anchorIndex + 1].item) ? flattened[anchorIndex + 1] : flattened[anchorIndex + 1]
        }
      : null
  ].filter((pair): pair is { from: typeof flattened[number]; to: typeof flattened[number]; holder: typeof flattened[number] } => Boolean(pair));
  if (!pairs.length) return { itinerary, changed: false };

  const updates = new Map<string, RoamlyActivitySeed>();
  for (const pair of pairs) {
    if (!isTransitionItem(pair.holder.item)) continue;
    const fromItemId = timelineItemId(pair.from.item, pair.from.day.day_number, pair.from.itemIndex);
    const toItemId = timelineItemId(pair.to.item, pair.to.day.day_number, pair.to.itemIndex);
    const holder = timelineRecord(pair.holder.item);
    const currentEvidence = forceInvalidate ? null : routeEvidenceFor(holder.route_evidence, fromItemId, toItemId);
    const result = evaluateRouteTransition({
      from: endpointForItem(pair.from.item, fromItemId),
      to: endpointForItem(pair.to.item, toItemId),
      schedule: {
        previousEndMinutes: absoluteItemMinutes(pair.from.item, pair.from.dayIndex, "endTime"),
        nextStartMinutes: absoluteItemMinutes(pair.to.item, pair.to.dayIndex, "startTime")
      },
      evidence: currentEvidence,
      confirmedBooking: pair.to === anchor
        ? { bookingId, fixedStartMinutes: absoluteItemMinutes(anchor.item, anchor.dayIndex, "startTime") }
        : null
    });
    const next = { ...holder };
    const staleEvidence = holder.route_evidence != null && !currentEvidence;
    if (currentEvidence) {
      next.routing_status = result.feasibility;
      next.route_evidence = currentEvidence;
      if (result.requiredMinutes != null && isTransitionItem(pair.holder.item)) {
        next.travelTimeMinutes = result.requiredMinutes;
        next.durationMinutes = result.requiredMinutes;
      }
    } else if (forceInvalidate || staleEvidence || holder.routing_status === "FEASIBLE" || holder.routing_status === "INFEASIBLE") {
      next.routing_status = "UNCERTAIN";
      next.route_evidence = null;
      next.travelTimeMinutes = undefined;
      next.durationMinutes = undefined;
      next.uncertainty = routeUncertainty(next);
      // A stale route's map target is not safe to reuse after its endpoint changed.
      next.map_query = "";
    } else {
      continue;
    }
    const changed = JSON.stringify(holder) !== JSON.stringify(next);
    if (changed) updates.set(`${pair.holder.dayIndex}:${pair.holder.itemIndex}`, next);
  }
  if (!updates.size) return { itinerary, changed: false };
  const daily_itinerary = itinerary.daily_itinerary.map((day, dayIndex) => ({
    ...day,
    live_timeline: day.live_timeline.map((item, itemIndex) => updates.get(`${dayIndex}:${itemIndex}`) || item)
  }));
  return { itinerary: { ...itinerary, daily_itinerary }, changed: true };
}

export function reconcileConfirmedBookingRouting(itinerary: RoamlyItinerary, booking: BookingOverrideRecord) {
  if (!bookingIsConfirmed(booking) || !bookingIsCurrent(booking)) return { itinerary, changed: false };
  return reconcileAffectedBookingRouting(itinerary, booking, false);
}

function nonFlightCategory(booking: BookingOverrideRecord): RoamlyActivitySeed["item_type"] {
  const type = clean(booking.booking_type).toLowerCase();
  if (type === "hotel") return "hotel";
  if (type === "restaurant") return "meal";
  if (["transport", "car_rental"].includes(type)) return "transfer";
  return "activity";
}

function applyNonFlightBookingOverrideToItinerary(itinerary: RoamlyItinerary, booking: BookingOverrideRecord) {
  const date = bookingDate(booking);
  if (!date || !booking.id) return { itinerary, changed: false };
  const dayIndex = itinerary.daily_itinerary.findIndex((day, index) => day.date ? isoDate(day.date) === date : index === 0);
  const index = dayIndex >= 0 ? dayIndex : 0;
  const day = itinerary.daily_itinerary[index];
  if (!day) return { itinerary, changed: false };
  const timeline = [...(day.live_timeline || [])];
  const marker = String(booking.id);
  const recommendationId = clean(booking.recommendation_id);
  const markedIndex = timeline.findIndex((item) => {
    const record = item as unknown as Record<string, unknown>;
    return String(record.booking_id || "") === marker || (recommendationId && String(record.candidateId || "") === recommendationId);
  });
  const truth = bookingTruth(booking);
  const cancelled = truth === "cancelled";
  const refunded = truth === "refunded";
  const discarded = truth === "discarded";
  const inactive = cancelled || refunded || discarded;
  // Round 2 Lane E2: travelerConfirmedOnly is active for the traveler
  // but NOT provider-verified — it stamps honestly and earns neither
  // the verified factual status nor the protected-anchor role.
  const travelerOnly = truth === "traveler_confirmed";
  const existing = markedIndex >= 0 ? timelineRecord(timeline[markedIndex]) : null;
  const provider = clean(booking.provider || booking.provider_name);
  const title = clean(booking.title) || provider || "Your reservation";
  const reference = clean(booking.confirmation_number) || clean((booking.reservation_requirements || {}).confirmation_number);
  const start = bookingStart(booking);
  const startMinutes = minutesFromDate(start, clean(booking.timezone || booking.metadata?.timezone)) ?? clockMinutes(existing?.startTime) ?? 9 * 60;
  const item = {
    item_id: clean(existing?.item_id) || marker,
    time_label: start ? formatTimeLabel(startMinutes) : clean(existing?.time_label) || formatTimeLabel(startMinutes),
    startTime: start ? formatTime24(startMinutes) : clean(existing?.startTime) || undefined,
    endTime: start ? undefined : clean(existing?.endTime) || undefined,
    title: titleForTruth(title, truth, bookingTruthInput(booking)),
    description: [
      discarded
        ? "This booking was removed; do not navigate to it."
        : cancelled
        ? "This booking was cancelled; do not navigate to it."
        : refunded
          ? "This booking was refunded; do not navigate to it."
          : travelerOnly
            ? "Confirmed by you; this replaces the itinerary recommendation as the actual reservation."
            : `${bookingProvenanceDisplayLabel(booking)}; this replaces the itinerary recommendation as the actual reservation.`,
      provider,
      reference ? `Reference ${reference}` : "",
      clean(booking.destination || booking.origin)
    ].filter(Boolean).join(" "),
    location_name: clean(booking.location_name || booking.address || booking.destination || booking.origin) || clean(existing?.location_name),
    estimated_cost: 0,
    category: discarded ? "Removed booking" : cancelled ? "Cancelled booking" : refunded ? "Refunded booking" : travelerOnly ? "Confirmed by you" : bookingProvenanceDisplayLabel(booking),
    map_query: clean(booking.destination || booking.origin) || clean(existing?.map_query) || title,
    item_type: inactive ? nonFlightCategory(booking) : "booking",
    plan_role: inactive || travelerOnly ? "supporting" : "protected_anchor",
    // Workstream A + Round 2 Lane E2: only a confirmation-evidence booking
    // earns the verified factual status and FACTUAL timing. A
    // cancelled/refunded stamp is neutral, and a travelerConfirmedOnly
    // stamp is honest but unverified — neither is ever "verified".
    factualStatus: inactive || travelerOnly ? "unknown" : "verified",
    timing_status: inactive || travelerOnly ? "UNKNOWN" : start ? "FACTUAL" : existing?.timing_status || "UNKNOWN",
    coordinates: booking.coordinates || existing?.coordinates || undefined,
    // Coordinate provenance (map-honesty fix, 2026-11-07): the
    // booking record's own coordinates are a true place point;
    // coordinates kept from the replaced item keep that item's
    // stamp, so an area-precision centre point can never silently
    // upgrade to a property pin by passing through a booking.
    coordinateSource: booking.coordinates ? "booking_record" : existing?.coordinateSource || undefined,
    coordinatePrecision: booking.coordinates ? "place" : existing?.coordinatePrecision || undefined,
    route_evidence: existing?.route_evidence || null,
    routing_status: existing?.routing_status || undefined,
    uncertainty: existing?.uncertainty || [],
    booking_id: marker,
    booking_status: discarded ? "discarded" : cancelled ? "cancelled" : refunded ? "refunded" : travelerOnly ? "traveler_confirmed" : "confirmed",
    booking_label: discarded ? "Removed booking" : cancelled ? "Cancelled booking" : refunded ? "Refunded booking" : travelerOnly ? "Confirmed by you" : bookingProvenanceDisplayLabel(booking)
  } as unknown as RoamlyActivitySeed;
  if (markedIndex >= 0) timeline[markedIndex] = item;
  else timeline.push(item);
  const daily_itinerary = itinerary.daily_itinerary.map((entry, entryIndex) => entryIndex === index ? { ...entry, live_timeline: timeline } : entry);
  return {
    itinerary: {
      ...itinerary,
      daily_itinerary,
      booking_status_summary: discarded
        ? "Removed bookings are marked and excluded from active trip guidance."
        : inactive
        ? "Cancelled bookings are marked and excluded from active trip guidance."
        : travelerOnly
          ? "Bookings confirmed by you are marked as yours; they are not provider-verified."
          : "Reservations with confirmation evidence on file are authoritative; itinerary recommendations remain visible as history only."
    },
    changed: true
  };
}

function flightItemIndex(items: RoamlyActivitySeed[], booking: BookingOverrideRecord) {
  const marker = clean(booking.id);
  const recommendationId = clean(booking.recommendation_id);
  return items.findIndex((item) => {
    const record = item as unknown as Record<string, unknown>;
    return (marker && String(record.booking_id || "") === marker) || (recommendationId && String(record.candidateId || "") === recommendationId);
  });
}

function bookingDetails(booking: BookingOverrideRecord) {
  const requirements = record(booking.reservation_requirements);
  const baggage = clean(requirements.baggage || requirements.baggage_allowance || requirements.checked_baggage);
  const duration = clean(requirements.duration || requirements.flight_duration);
  return [
    clean(booking.provider || booking.provider_name),
    clean(booking.flight_number) ? `Flight ${clean(booking.flight_number)}` : "",
    clean(booking.terminal) ? `Terminal ${clean(booking.terminal)}` : "",
    clean(booking.gate) ? `Gate ${clean(booking.gate)}` : "",
    baggage ? `Baggage: ${baggage}` : "",
    duration ? `Duration: ${duration}` : ""
  ].filter(Boolean);
}

function flightTitle(booking: BookingOverrideRecord, arrivalBlock = false) {
  const flight = clean(booking.flight_number);
  const provider = clean(booking.provider || booking.provider_name);
  const destination = clean(booking.destination || firstSegment(booking).destination);
  if (arrivalBlock && flight && destination) return `${flight} arrival in ${destination}`;
  if (arrivalBlock && flight) return `Flight ${flight} arrival`;
  if (flight && destination) return `${flight} to ${destination}`;
  if (flight) return `Flight ${flight}`;
  if (provider && destination) return `${provider} flight to ${destination}`;
  return clean(booking.title) || "Your flight";
}

function applyFlightOverrideToDay(items: RoamlyActivitySeed[], booking: BookingOverrideRecord, dayDate?: string | null) {
  const startValue = bookingStart(booking);
  const endValue = bookingEnd(booking);
  const start = minutesFromDate(startValue);
  const end = minutesFromDate(endValue);
  if (start == null) return { items, changed: false };
  const output = [...items];
  const matchedIndex = flightItemIndex(output, booking);
  const index = matchedIndex >= 0 ? matchedIndex : output.length;
  const existing = matchedIndex >= 0 ? output[matchedIndex] : undefined;
  const realDuration = minutesBetweenDates(startValue, endValue);
  const flightDuration =
    realDuration != null
      ? Math.max(30, realDuration)
      : end != null && end > start
        ? Math.max(30, end - start)
        : Math.max(60, existing ? durationMinutes(existing) : 90);
  const dayDateText = isoDate(dayDate);
  const arrivalDayBlock =
    Boolean(dayDateText && endValue && isoDate(endValue) === dayDateText && isoDate(startValue) !== dayDateText && end != null);
  const timelineStart = arrivalDayBlock && end != null ? Math.max(0, end - Math.min(90, flightDuration)) : start;
  const timelineDuration = arrivalDayBlock && end != null ? Math.max(30, end - timelineStart) : flightDuration;
  const details = bookingDetails(booking);
  const origin = clean(booking.origin || firstSegment(booking).origin || existing?.origin);
  const destination = clean(booking.destination || firstSegment(booking).destination || existing?.destination || existing?.location_name);
  output[index] = retime(
    {
      ...(existing || {
        time_label: "",
        title: "",
        description: "",
        location_name: "",
        estimated_cost: 0,
        category: "Travel",
        map_query: ""
      }),
      item_type: "travel",
      plan_role: "protected_anchor",
      factualStatus: "verified",
      timing_status: startValue ? "FACTUAL" : "UNKNOWN",
      booking_id: clean(booking.id),
      booking_status: clean(booking.booking_status) || "confirmed",
      category: "Flight",
      title: flightTitle(booking, arrivalDayBlock),
      description: [
        `${bookingProvenanceDisplayLabel(booking)} — this booking replaces the itinerary estimate.`,
        details.join(" · "),
        clean(existing?.description)
      ].filter(Boolean).join(" "),
      location_name: [origin, destination].filter(Boolean).join(" to ") || destination || origin || existing?.location_name || "",
      map_query: [origin, destination, clean(booking.flight_number)].filter(Boolean).join(" "),
      origin: origin || existing?.origin,
      destination: destination || existing?.destination,
      travel_mode: "flight",
      transportMode: "flight",
      travelTimeMinutes: flightDuration,
      durationMinutes: flightDuration,
      duration: `${flightDuration} min`,
      booking_label: undefined,
      booking: undefined
    } as unknown as RoamlyActivitySeed,
    timelineStart,
    timelineDuration
  );

  return { items: output, changed: true };
}

export function applyConfirmedBookingOverrideToItinerary(
  itinerary: RoamlyItinerary,
  booking: BookingOverrideRecord
) {
  // Workstream A + Round 2 Lane E2: the confirmation-evidence tier stamps verified;
  // travelerConfirmedOnly stamps the honest "Confirmed by you:" via
  // the non-flight path (a traveler-only FLIGHT earns no verified
  // flight override — bookingIsUsableFlight stays provider-only —
  // and stamps nothing here; the read path re-titles any stale stamp
  // honestly). Cancelled/refunded re-stamp neutral (the X1 write
  // path calls this after a cancel). Test bookings and every other
  // unverified state stamp nothing.
  if (!bookingStampsItinerary(booking) || !bookingIsCurrent(booking)) return { itinerary, changed: false };
  const truth = bookingTruth(booking);
  if (truth === "cancelled" || truth === "refunded" || truth === "discarded") {
    return applyNonFlightBookingOverrideToItinerary(itinerary, booking);
  }
  const routeFactsChanged = bookingFactsChanged(itinerary, booking);
  if (clean(booking.booking_type).toLowerCase() !== "flight") {
    const result = applyNonFlightBookingOverrideToItinerary(itinerary, booking);
    if (!result.changed) return result;
    const routing = reconcileAffectedBookingRouting(result.itinerary, booking, routeFactsChanged);
    return { itinerary: routing.itinerary, changed: result.changed || routing.changed };
  }
  if (!bookingIsUsableFlight(booking)) return { itinerary, changed: false };
  const startDate = isoDate(bookingStart(booking));
  const endDate = isoDate(bookingEnd(booking));
  const preferredDate = endDate || startDate;
  const dayIndex = itinerary.daily_itinerary.findIndex((day, index) => {
    if (day.date) return isoDate(day.date) === preferredDate || isoDate(day.date) === startDate;
    return index === 0;
  });
  const index = dayIndex >= 0 ? dayIndex : 0;
  const day = itinerary.daily_itinerary[index];
  if (!day) return { itinerary, changed: false };
  const adjusted = applyFlightOverrideToDay(day.live_timeline || [], booking, day.date);
  if (!adjusted.changed) return { itinerary, changed: false };
  const daily_itinerary = itinerary.daily_itinerary.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          title: itemIndex === 0 ? "Flight and arrival from your booking" : item.title,
          morning: itemIndex === 0 ? "Flight details from your booking replace the estimate; the affected day was revalidated without inventing transfer time." : item.morning,
          live_timeline: adjusted.items
        }
      : item
  );
  const result = {
    itinerary: {
      ...itinerary,
      daily_itinerary,
      booking_status_summary:
        "Booking details from your confirmation evidence override estimated travel times. Downstream same-day itinerary items were rebalanced from the real arrival time."
    },
    changed: true
  };
  const routing = reconcileAffectedBookingRouting(result.itinerary, booking, routeFactsChanged);
  return { itinerary: routing.itinerary, changed: result.changed || routing.changed };
}

function buildValidationPayload(trip: Record<string, unknown>): TripPlannerPayload | null {
  const destination = clean(trip.destination);
  const startDate = clean(trip.start_date);
  const endDate = clean(trip.end_date);
  if (!destination || !startDate || !endDate) return null;
  const daysCount = Number(trip.days_count);
  return {
    destination,
    startDate,
    endDate,
    daysCount: Number.isSafeInteger(daysCount) ? daysCount : null,
    budgetAmount: typeof trip.budget_amount === "number" ? trip.budget_amount : null,
    budgetCurrency: clean(trip.budget_currency) || "USD",
    travelStyle: clean(trip.travel_style) || "Balanced",
    interests: Array.isArray(trip.interests) ? trip.interests.filter((value): value is string => typeof value === "string") : [],
    pace: "Balanced",
    accommodationPreference: clean(trip.accommodation_preference) || "Not sure",
    transportationPreference: clean(trip.transportation_preference) || "Mixed",
    specialNotes: clean(trip.special_notes)
  };
}

function applyAffectedValidation(
  itinerary: RoamlyItinerary,
  validation: ReturnType<typeof validateItineraryDeterministically>,
  affectedDayNumbers: Set<number>
) {
  const findings = validation.findings.filter((finding) => finding.dayNumber != null && affectedDayNumbers.has(finding.dayNumber));
  if (!findings.length) return itinerary;
  const hasError = findings.some((finding) => finding.severity === "error");
  const messages = findings.map((finding) => finding.message).slice(0, 4);
  return {
    ...itinerary,
    daily_itinerary: itinerary.daily_itinerary.map((day) => {
      if (!affectedDayNumbers.has(day.day_number)) return day;
      return {
        ...day,
        plan_status: (hasError ? "conflict" : "uncertain") as "conflict" | "uncertain",
        uncertainty: Array.from(new Set([...(day.uncertainty || []), ...messages])).slice(0, 8)
      };
    })
  };
}

export async function applyStoredItineraryBookingOverride(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  booking: BookingOverrideRecord;
}) {
  if (!bookingStampsItinerary(params.booking) || !bookingIsCurrent(params.booking)) return { ok: true as const, changed: false };
  const { data, error } = await params.supabase
    .from("roamly_itineraries")
    .select("id,full_json,repair_revision")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  const full = record(data?.full_json) as unknown as RoamlyItinerary;
  if (!data?.id || !Array.isArray(full.daily_itinerary)) return { ok: true as const, changed: false };
  const repairRevision = Number(data.repair_revision);
  if (!Number.isSafeInteger(repairRevision) || repairRevision < 0) {
    return { ok: false as const, error: "ITINERARY_REVISION_UNAVAILABLE" };
  }

  const result = applyConfirmedBookingOverrideToItinerary(full, params.booking);
  if (!result.changed) return { ok: true as const, changed: false };
  const reconciled = result.itinerary;

  const tripResult = await params.supabase
    .from("roamly_trips")
    .select("destination,start_date,end_date,days_count,budget_amount,budget_currency,travel_style,interests,accommodation_preference,transportation_preference,special_notes")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (tripResult.error) return { ok: false as const, error: tripResult.error.message };

  const affectedDayNumbers = new Set<number>();
  const bookingDateValue = bookingDate(params.booking);
  reconciled.daily_itinerary.forEach((day) => {
    if (!bookingDateValue || isoDate(day.date) === bookingDateValue) affectedDayNumbers.add(day.day_number);
  });
  const payload = tripResult.data ? buildValidationPayload(tripResult.data as Record<string, unknown>) : null;
  const reconciledItinerary = payload
    ? applyAffectedValidation(
        reconciled,
        validateItineraryDeterministically({ itinerary: reconciled, payload }),
        affectedDayNumbers
      )
    : reconciled;

  const update = await params.supabase
    .from("roamly_itineraries")
    .update({
      full_json: reconciledItinerary,
      preview_json: buildPreviewFromItinerary(reconciledItinerary),
      repair_revision: repairRevision + 1
    })
    .eq("id", data.id)
    .eq("user_id", params.userId)
    .eq("repair_revision", repairRevision)
    .select("id")
    .maybeSingle();

  if (update.error) return { ok: false as const, error: update.error.message };
  if (!update.data) return { ok: false as const, error: "STALE_ITINERARY_STATE" };
  return { ok: true as const, changed: true };
}

/**
 * X1 READ path (Workstream A): re-derive every stored booking-linked
 * itinerary item's displayed confirmation state from its booking's
 * CURRENT truth, at render time, with no data rewrite. This covers
 * existing stale rows — e.g. an item stamped "Confirmed:" before its
 * booking was cancelled — wherever the trip page renders the stored
 * itinerary.
 *
 * An item is booking-linked when it carries the booking's id
 * (override-stamped items always do), or, failing that, when its
 * stamp-stripped title exactly matches a booking's title. Truth
 * "confirmed" (providerConfirmationEvidence ONLY) re-stamps its plain "Confirmed:" title to the provenance stamp
 * (the stored stamp agrees). Any other state rewrites the display
 * fields honestly: cancelled/refunded re-title as such,
 * traveler_confirmed re-titles "Confirmed by you:" with the verified
 * factual status and protected-anchor role removed, and everything
 * else (test, superseded, needs_confirmation, email_unverified,
 * planned) loses the Confirmed stamp, the verified factual status,
 * and the protected-anchor role.
 * Items with no linked booking are returned unchanged.
 */
export function reconcileItineraryItemsWithCurrentBookings(
  itinerary: RoamlyItinerary,
  bookings: BookingOverrideRecord[]
): RoamlyItinerary {
  if (!itinerary || !Array.isArray(itinerary.daily_itinerary) || !bookings.length) return itinerary;
  const byId = new Map<string, BookingOverrideRecord>();
  const byTitle = new Map<string, BookingOverrideRecord>();
  for (const booking of bookings) {
    if (booking.id) byId.set(String(booking.id), booking);
    const title = clean(booking.title).toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, booking);
  }
  let changed = false;
  const truthLabel: Record<string, string> = {
    cancelled: "Cancelled booking",
    refunded: "Refunded booking",
    discarded: "Removed booking",
    traveler_confirmed: "Confirmed by you",
    test: "Test booking",
    superseded: "Superseded booking",
    needs_confirmation: "Needs your confirmation",
    email_unverified: "From your email — not verified",
    planned: "Planned"
  };
  const daily_itinerary = itinerary.daily_itinerary.map((day) => {
    if (!Array.isArray(day.live_timeline)) return day;
    let dayChanged = false;
    const live_timeline = day.live_timeline.map((item) => {
      const value = timelineRecord(item);
      const bookingId = clean(value.booking_id);
      const title = clean(value.title);
      const linked =
        (bookingId ? byId.get(bookingId) : undefined) ||
        (title ? byTitle.get(stripBookingStampPrefix(title).toLowerCase()) : undefined);
      if (!linked) return item;
      const state = bookingTruth(linked);
      if (state === "confirmed") {
        // Round 3 (Lane T): a stored plain "Confirmed:" stamp is an
        // overclaim for this tier — re-title with the provenance
        // stamp from the linked booking. Factual status and anchor
        // role stay as stored (the tier still earns them).
        const restamped = titleForTruth(title, state, bookingTruthInput(linked));
        const label = bookingProvenanceDisplayLabel(linked);
        const nextConfirmed: TimelineRecord = { ...value };
        let touched = false;
        if (title && restamped !== title) { nextConfirmed.title = restamped; touched = true; }
        if (clean(value.category) === "Confirmed booking") { nextConfirmed.category = label; touched = true; }
        if (clean(value.booking_label) === "Confirmed booking") { nextConfirmed.booking_label = label; touched = true; }
        const desc = clean(value.description);
        if (desc.startsWith("Confirmed booking;")) {
          nextConfirmed.description = desc.replace(/^Confirmed booking;/, `${label};`);
          touched = true;
        }
        if (!touched) return item;
        changed = true; dayChanged = true;
        return nextConfirmed as unknown as RoamlyActivitySeed;
      }
      const next: TimelineRecord = { ...value };
      if (title) next.title = titleForTruth(title, state);
      if (clean(value.booking_status) === "confirmed" || value.booking_status != null) {
        next.booking_status = state;
      }
      if (value.factualStatus === "verified") next.factualStatus = "unknown";
      if (clean(value.timing_status).toUpperCase() === "FACTUAL" && (state === "cancelled" || state === "refunded" || state === "discarded" || state === "test" || state === "traveler_confirmed")) {
        next.timing_status = "UNKNOWN";
      }
      if (value.plan_role === "protected_anchor") next.plan_role = "supporting";
      if (clean(value.category) === "Confirmed booking") next.category = truthLabel[state] || "Booking";
      if (clean(value.booking_label) === "Confirmed booking") next.booking_label = truthLabel[state] || "Booking";
      const description = clean(value.description);
      if (description.startsWith("Confirmed booking;")) {
        next.description =
          state === "cancelled"
            ? description.replace(/^Confirmed booking;[^.]*\./, "This booking was cancelled; do not navigate to it.")
            : state === "traveler_confirmed"
              ? description.replace(/^Confirmed booking;/, "Confirmed by you;")
              : description.replace(/^Confirmed booking;\s*/, "");
      }
      if (JSON.stringify(next) !== JSON.stringify(value)) {
        dayChanged = true;
        return next as unknown as RoamlyActivitySeed;
      }
      return item;
    });
    if (dayChanged) changed = true;
    return dayChanged ? { ...day, live_timeline } : day;
  });
  return changed ? { ...itinerary, daily_itinerary } : itinerary;
}
