import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPreviewFromItinerary,
  type RoamlyActivitySeed,
  type RoamlyItinerary
} from "@/lib/itinerary";

type BookingOverrideRecord = {
  id?: string | null;
  booking_type?: string | null;
  booking_status?: string | null;
  provider?: string | null;
  provider_name?: string | null;
  title?: string | null;
  start_time?: string | null;
  start_at?: string | null;
  end_time?: string | null;
  end_at?: string | null;
  origin?: string | null;
  destination?: string | null;
  flight_number?: string | null;
  terminal?: string | null;
  gate?: string | null;
  reservation_requirements?: Record<string, unknown> | null;
  traveler_confirmed?: boolean | null;
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

function parseClock(value?: string | null) {
  const raw = clean(value);
  if (!raw) return null;
  const military = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const hour = Number(military[1]);
    const minute = Number(military[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }
  const twelve = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!twelve) return null;
  let hour = Number(twelve[1]);
  const minute = Number(twelve[2] || "0");
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (twelve[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (twelve[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
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

function flightItemIndex(items: RoamlyActivitySeed[]) {
  const index = items.findIndex((item) => {
    const text = `${item.item_type || ""} ${item.category || ""} ${item.title} ${item.description}`.toLowerCase();
    return /\bflight|fly|airport|arrival|depart|main .*segment|travel to\b/.test(text);
  });
  return index >= 0 ? index : 0;
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
  const index = flightItemIndex(output);
  const existing = output[index] || output[0];
  const realDuration = minutesBetweenDates(startValue, endValue);
  const flightDuration =
    realDuration != null
      ? Math.max(30, realDuration)
      : end != null && end > start
        ? Math.max(30, end - start)
        : Math.max(60, durationMinutes(existing));
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
      category: "Flight",
      title: flightTitle(booking, arrivalDayBlock),
      description: [
        "Confirmed booking replaces the itinerary estimate.",
        details.join(" · "),
        clean(existing?.description)
      ].filter(Boolean).join(" "),
      location_name: [origin, destination].filter(Boolean).join(" to ") || destination || origin || existing?.location_name || "Airport",
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
    },
    timelineStart,
    timelineDuration
  );

  const previous = output[index - 1];
  if (previous) {
    const previousDuration = Math.min(Math.max(durationMinutes(previous), 45), 120);
    const previousStart = Math.max(0, timelineStart - previousDuration - 120);
    output[index - 1] = retime(
      {
        ...previous,
        title: /\bairport|security|terminal|leave|depart/i.test(previous.title)
          ? previous.title
          : "Airport arrival and security buffer",
        description: `Use the real flight departure time. Arrive early for check-in, baggage, security, terminal/gate checks, and documents. ${previous.description}`.trim(),
        item_type: "reminder"
      },
      previousStart,
      previousDuration
    );
  }

  const sameDayArrival = endValue && isoDate(endValue) === isoDate(startValue);
  const arrivalCursor =
    end != null && (sameDayArrival || arrivalDayBlock)
      ? end
      : Math.min(23 * 60, timelineStart + Math.min(timelineDuration, 23 * 60 - timelineStart));
  let cursor = arrivalCursor + 30;
  for (let i = index + 1; i < output.length; i += 1) {
    const item = output[i];
    const type = itemType(item);
    const existingStart = parseClock(item.startTime || item.time_label);
    const needsShift = existingStart == null || existingStart < cursor || i <= index + 4;
    if (!needsShift) {
      cursor = Math.max(cursor, existingStart + durationMinutes(item) + (type === "activity" || type === "meal" ? 15 : 0));
      continue;
    }
    const duration = Math.min(durationMinutes(item), type === "transfer" ? 75 : type === "hotel" ? 120 : 150);
    output[i] = retime(
      {
        ...item,
        description:
          i === index + 1
            ? `Shifted after the confirmed flight arrival. ${item.description}`.trim()
            : item.description
      },
      Math.min(cursor, 23 * 60),
      duration
    );
    cursor = (parseClock(output[i].endTime) || cursor + duration) + (type === "activity" || type === "meal" ? 15 : 0);
  }

  return { items: output, changed: true };
}

export function applyConfirmedBookingOverrideToItinerary(
  itinerary: RoamlyItinerary,
  booking: BookingOverrideRecord
) {
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
          title: itemIndex === 0 ? "Confirmed flight, arrival, and adjusted first-day plan" : item.title,
          morning: itemIndex === 0 ? "Confirmed flight details replace the estimate; downstream plans are shifted from the real arrival time." : item.morning,
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

export async function applyStoredItineraryBookingOverride(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  booking: BookingOverrideRecord;
}) {
  if (!bookingIsUsableFlight(params.booking)) return { ok: true as const, changed: false };
  const { data, error } = await params.supabase
    .from("roamly_itineraries")
    .select("id,full_json")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  const full = record(data?.full_json) as unknown as RoamlyItinerary;
  if (!data?.id || !Array.isArray(full.daily_itinerary)) return { ok: true as const, changed: false };

  const result = applyConfirmedBookingOverrideToItinerary(full, params.booking);
  if (!result.changed) return { ok: true as const, changed: false };

  const update = await params.supabase
    .from("roamly_itineraries")
    .update({
      full_json: result.itinerary,
      preview_json: buildPreviewFromItinerary(result.itinerary)
    })
    .eq("id", data.id)
    .eq("user_id", params.userId);

  if (update.error) return { ok: false as const, error: update.error.message };
  return { ok: true as const, changed: true };
}
