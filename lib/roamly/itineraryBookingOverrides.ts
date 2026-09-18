import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPreviewFromItinerary,
  type RoamlyActivitySeed,
  type RoamlyItinerary
} from "@/lib/itinerary";
import { validateItineraryDeterministically } from "@/lib/roamly/itineraryValidation";
import { isOperationalCurrentBooking } from "@/lib/roamly/bookingSupersession";
import type { TripPlannerPayload } from "@/lib/trip-planner";

type BookingOverrideRecord = {
  id?: string | null;
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
  flight_number?: string | null;
  terminal?: string | null;
  gate?: string | null;
  reservation_requirements?: Record<string, unknown> | null;
  traveler_confirmed?: boolean | null;
  booking_segments?: Array<Record<string, unknown>> | null;
};

const activeBookingStatuses = ["booked", "paid", "reserved", "confirmed", "modified", "completed"];

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

function minutesFromDate(value?: string | null) {
  const date = parseDate(value);
  if (!date) return null;
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
  const status = clean(booking.booking_status).toLowerCase();
  return (
    type === "flight" &&
    Boolean(bookingStart(booking)) &&
    (booking.traveler_confirmed === true || ["confirmed", "modified", "completed", "booked", "paid", "reserved"].includes(status))
  );
}

function bookingIsConfirmed(booking: BookingOverrideRecord) {
  const status = clean(booking.booking_status).toLowerCase();
  return Boolean(booking.id) && (booking.traveler_confirmed === true || activeBookingStatuses.includes(status) || status === "cancelled");
}

function bookingIsCurrent(booking: BookingOverrideRecord) {
  return isOperationalCurrentBooking(booking);
}

function bookingDate(booking: BookingOverrideRecord) {
  return isoDate(bookingStart(booking) || booking.end_time || booking.end_at);
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
  const status = clean(booking.booking_status).toLowerCase();
  const cancelled = status === "cancelled";
  const provider = clean(booking.provider || booking.provider_name);
  const title = clean(booking.title) || provider || "Confirmed reservation";
  const reference = clean(booking.confirmation_number) || clean((booking.reservation_requirements || {}).confirmation_number);
  const start = bookingStart(booking);
  const startMinutes = minutesFromDate(start) ?? 9 * 60;
  const item = {
    time_label: formatTimeLabel(startMinutes),
    startTime: formatTime24(startMinutes),
    title: `${cancelled ? "Cancelled" : "Confirmed"}: ${title}`,
    description: [
      cancelled ? "This booking was cancelled; do not navigate to it." : "Confirmed booking; this replaces the itinerary recommendation as the actual reservation.",
      provider,
      reference ? `Reference ${reference}` : "",
      clean(booking.destination || booking.origin)
    ].filter(Boolean).join(" "),
    location_name: clean(booking.location_name || booking.address || booking.destination || booking.origin),
    estimated_cost: 0,
    category: cancelled ? "Cancelled booking" : "Confirmed booking",
    map_query: clean(booking.destination || booking.origin || title),
    item_type: cancelled ? nonFlightCategory(booking) : "booking",
    plan_role: cancelled ? "supporting" : "protected_anchor",
    factualStatus: "verified",
    timing_status: start ? "FACTUAL" : "UNKNOWN",
    coordinates: booking.coordinates || undefined,
    booking_id: marker,
    booking_status: cancelled ? "cancelled" : "confirmed",
    booking_label: cancelled ? "Cancelled booking" : "Confirmed booking"
  } as unknown as RoamlyActivitySeed;
  if (markedIndex >= 0) timeline[markedIndex] = item;
  else timeline.push(item);
  const daily_itinerary = itinerary.daily_itinerary.map((entry, entryIndex) => entryIndex === index ? { ...entry, live_timeline: timeline } : entry);
  return {
    itinerary: {
      ...itinerary,
      daily_itinerary,
      booking_status_summary: cancelled
        ? "Cancelled bookings are marked and excluded from active trip guidance."
        : "Confirmed reservations are authoritative; itinerary recommendations remain visible as history only."
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
  return clean(booking.title) || "Confirmed flight";
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
        "Confirmed booking replaces the itinerary estimate.",
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
  if (!bookingIsConfirmed(booking) || !bookingIsCurrent(booking)) return { itinerary, changed: false };
  if (clean(booking.booking_type).toLowerCase() !== "flight") {
    return applyNonFlightBookingOverrideToItinerary(itinerary, booking);
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
          title: itemIndex === 0 ? "Confirmed flight and arrival" : item.title,
          morning: itemIndex === 0 ? "Confirmed flight details replace the estimate; the affected day was revalidated without inventing transfer time." : item.morning,
          live_timeline: adjusted.items
        }
      : item
  );
  return {
    itinerary: {
      ...itinerary,
      daily_itinerary,
      booking_status_summary:
        "Confirmed booking details override estimated travel times. Downstream same-day itinerary items were rebalanced from the real arrival time."
    },
    changed: true
  };
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
  if (!bookingIsConfirmed(params.booking) || !bookingIsCurrent(params.booking)) return { ok: true as const, changed: false };
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

  const tripResult = await params.supabase
    .from("roamly_trips")
    .select("destination,start_date,end_date,days_count,budget_amount,budget_currency,travel_style,interests,accommodation_preference,transportation_preference,special_notes")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (tripResult.error) return { ok: false as const, error: tripResult.error.message };

  const affectedDayNumbers = new Set<number>();
  const bookingDateValue = bookingDate(params.booking);
  result.itinerary.daily_itinerary.forEach((day) => {
    if (!bookingDateValue || isoDate(day.date) === bookingDateValue) affectedDayNumbers.add(day.day_number);
  });
  const payload = tripResult.data ? buildValidationPayload(tripResult.data as Record<string, unknown>) : null;
  const reconciledItinerary = payload
    ? applyAffectedValidation(
        result.itinerary,
        validateItineraryDeterministically({ itinerary: result.itinerary, payload }),
        affectedDayNumbers
      )
    : result.itinerary;

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
