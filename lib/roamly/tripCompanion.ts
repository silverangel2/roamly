import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  crossBorderTravelDocumentReminders,
  crossBorderTravelNotes,
  detectCrossBorderTrip,
  normalizeCountry
} from "@/lib/roamly/crossBorder";
import { recordTripEvent } from "@/lib/roamly/events";
import { getTripBudgetCurrency, getTripDestinationLabel, getTripOriginLabel, getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";
import { isOperationalCurrentBooking } from "@/lib/roamly/bookingSupersession";
import { shouldSuppressScheduledBookingEvent } from "@/lib/roamly/operationalScheduledEvents";
import { bookingTruthState, isInactiveTruthState } from "@/lib/roamly/bookingTruth";

type CompanionTrip = {
  id: string;
  user_id: string;
  destination?: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  destination_country?: string | null;
  origin?: string | null;
  origin_country?: string | null;
  budget_currency?: string | null;
  start_date: string | null;
  end_date: string | null;
  days_count?: number | null;
  live_companion_unlocked?: boolean | null;
  live_companion_unlocked_at?: string | null;
  live_companion_source?: string | null;
  trip_companion_status?: string | null;
  tracking_unlocked?: boolean | null;
  tracking_unlock_source?: string | null;
  tracking_paid_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

type CompanionBooking = {
  id: string;
  booking_type: string;
  title: string | null;
  provider_name: string | null;
  start_date: string | null;
  start_time: string | null;
  start_at?: string | null;
  end_at?: string | null;
  address: string | null;
  city: string | null;
  user_id?: string | null;
  trip_id?: string | null;
  booking_status?: string | null;
  superseded_by_booking_id?: string | null;
  traveler_confirmed?: boolean | null;
  confirmation_number?: string | null;
  source_type?: string | null;
  metadata?: Record<string, unknown> | null;
};

function addDays(date: string, days: number) {
  const next = new Date(`${date}T09:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function startOfTrip(date: string | null) {
  return date ? new Date(`${date}T09:00:00Z`).toISOString() : null;
}

function bookingReminderTime(booking: CompanionBooking) {
  if (booking.start_at) return booking.start_at;
  return booking.start_date
    ? new Date(`${booking.start_date}T${booking.start_time || "09:00"}:00Z`).toISOString()
    : null;
}

export function tripHasLiveCompanionUnlock(trip: Pick<CompanionTrip, "live_companion_unlocked" | "tracking_unlocked">) {
  return Boolean(trip.live_companion_unlocked || trip.tracking_unlocked);
}

export async function isLiveCompanionUnlocked(supabase: SupabaseClient, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_trips")
    .select("tracking_unlocked,live_companion_unlocked")
    .eq("id", tripId)
    .maybeSingle();
  if (error) return { unlocked: false, error: error.message };
  return { unlocked: tripHasLiveCompanionUnlock(data || {}), error: null };
}

export type CountryInfoRoute = {
  /** Origin country from the trip's own record (may be inferred from its labels). */
  originCountry?: string | null;
  /** True when the trip's own origin/destination countries are known to differ. */
  crossBorder?: boolean;
};

/**
 * Round 2, HIGH 4 (builder B, carried into B2): the guidance set is
 * derived from the trip's own origin/destination countries — the old
 * builder took no origin at all and gave every trip the cross-border
 * set, so a domestic trip got passport, embassy, and roaming advice.
 * Domestic trips now get only the bullets that are actually
 * applicable. International trips keep the applicable set. When the
 * route countries cannot be determined, only the generally applicable
 * bullets are shown — missing data is never filled with generic
 * cross-border bullets.
 *
 * B2 extension: the domestic set follows the owner-approved composite
 * panel's four notes (government-issued ID; confirm flight/bus
 * schedule; check weather and pack; emergency number). The schedule
 * line is guidance to confirm the traveler's own schedule, never a
 * claimed schedule. The literal emergency number is scoped to Canada
 * domestic only — 911 is Canada's emergency number (Government of
 * Canada: "In case of emergency: 911") — and every other domestic
 * country keeps the generic emergency-numbers line, because this
 * codebase holds no verified emergency number for any other country
 * and one must never be invented.
 */
export function buildCountryInfo(
  destinationCountry?: string | null,
  destinationCity?: string | null,
  route?: CountryInfoRoute
) {
  const place = [destinationCity, destinationCountry].filter(Boolean).join(", ") || "your destination";
  const origin = normalizeCountry(route?.originCountry);
  const destination = normalizeCountry(destinationCountry);
  const isDomestic = Boolean(origin && destination && origin === destination);
  const isInternational = route?.crossBorder === true || Boolean(origin && destination && origin !== destination);
  const routeType: "domestic" | "international" | "unknown" = isDomestic
    ? "domestic"
    : isInternational
      ? "international"
      : "unknown";
  if (isDomestic || !isInternational) {
    return {
      title: `Travel notes for ${place}`,
      summary: isDomestic
        ? "Check official government and destination sources before travel."
        : "Route countries are not confirmed for this trip, so only generally applicable notes are shown. Check official government and destination sources before travel.",
      reminders: isDomestic
        ? [
            "Check your government-issued ID for domestic travel.",
            "Confirm your flight or bus schedule and allow extra time for potential delays.",
            "Check weather and pack appropriate clothing.",
            destination === "canada"
              ? "Save local emergency number: 911."
              : "Confirm local emergency numbers before you travel."
          ]
        : [
            "Confirm local emergency numbers before you travel.",
            "Check weather, transit disruptions, and local safety updates before leaving."
          ],
      routeType
    };
  }
  return {
    title: `Travel notes for ${place}`,
    summary: "Check official government, embassy, airline, and destination sources before travel.",
    reminders: [
      "Verify entry documents and passport validity.",
      "Confirm roaming or eSIM before departure and check device compatibility before buying.",
      "Confirm local emergency numbers and nearest embassy or consulate.",
      "Check weather, transit disruptions, and local safety updates before leaving."
    ],
    routeType
  };
}

/** Cross-border bullets, for the render-time guard on stored records. */
export const CROSS_BORDER_BULLET_PATTERN = /passport|embassy|consulate|roaming|eSIM|visa|entry documents/i;

/** A stored domestic country-info record must never carry cross-border bullets. */
export function filterDomesticCountryInfoReminders(reminders: string[]) {
  return reminders.filter((reminder) => !CROSS_BORDER_BULLET_PATTERN.test(reminder));
}

function getCompanionCrossBorderInfo(trip: CompanionTrip) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return detectCrossBorderTrip({
    origin: getTripOriginLabel(trip) || trip.origin || "",
    originCountry:
      trip.origin_country ||
      (typeof planning.originCountry === "string" ? planning.originCountry : "") ||
      (typeof planning.origin_country === "string" ? planning.origin_country : ""),
    destination: getTripDestinationLabel(trip),
    destinationCountry: trip.destination_country,
    routeText: `${getTripOriginLabel(trip) || ""} ${getTripDestinationLabel(trip) || ""}`,
    originCurrency: getTripBudgetCurrency(trip),
    destinationCurrency: undefined
  });
}

export function buildPackingChecklist(trip: CompanionTrip) {
  const destination = getTripDestinationLabel(trip) || "the destination";
  const crossBorder = getCompanionCrossBorderInfo(trip).cross_border;
  return [
    ...(crossBorder ? crossBorderTravelDocumentReminders(false) : ["Passport or government ID"]),
    "Travel insurance details",
    "Phone charger and power bank",
    "Weather-appropriate clothing",
    "Medication and basic first aid",
    `Offline maps for ${destination}`
  ];
}

export function buildDocumentChecklist(trip?: CompanionTrip) {
  if (trip && getCompanionCrossBorderInfo(trip).cross_border) return crossBorderTravelDocumentReminders(false);
  // Round 2, HIGH 4 (same finding, adjacent panel): a domestic trip
  // gets no passport/visa lines — only the lines that actually apply.
  if (trip) {
    const info = getCompanionCrossBorderInfo(trip);
    if (info.origin_country && info.destination_country && info.origin_country === info.destination_country) {
      return ["Flight, hotel, and activity confirmations", "Travel insurance", "Emergency contact details"];
    }
  }
  return ["Passport validity", "Visa or eTA requirement", "Flight, hotel, and activity confirmations", "Travel insurance", "Emergency contact details"];
}

export function buildPreTripTimeline(trip: CompanionTrip, bookings: CompanionBooking[] = []) {
  const start = trip.start_date;
  const crossBorderInfo = getCompanionCrossBorderInfo(trip);
  const crossBorderEvents = crossBorderInfo.cross_border
    ? [
        start
          ? {
              event_type: "cross_border_documents",
              title: "Check passport and travel documents",
              body: "Check passport, visa / ESTA / eTA if applicable, booking confirmations, and return/onward travel proof. Check official entry requirements before travel.",
              scheduled_for: addDays(start, -7)
            }
          : null,
        start
          ? {
              event_type: "offline_maps",
              title: "Download offline maps",
              body: "Download offline maps for your route and destination before crossing the border, and save key addresses for offline access.",
              scheduled_for: addDays(start, -3)
            }
          : null,
        start
          ? {
              event_type: "roaming_esim",
              title: "Confirm roaming or eSIM before departure",
              body: "Compare roaming or travel eSIM options before departure. Check coverage, device compatibility, speed limits, and refund rules before buying.",
              scheduled_for: addDays(start, -3)
            }
          : null,
        start
          ? {
              event_type: "save_hotel_address_offline",
              title: "Save hotel address offline",
              body: "Save your hotel address, booking confirmation, and arrival directions where they work without mobile data.",
              scheduled_for: addDays(start, -3)
            }
          : null,
        start
          ? {
              event_type: "destination_emergency_number",
              title: "Check destination emergency number",
              body: "Save the local emergency number and an emergency contact before departure.",
              scheduled_for: addDays(start, -3)
            }
          : null,
        start
          ? {
              event_type: "border_documents",
              title: "Prepare border crossing documents",
              body: "Prepare passport, booking confirmations, and driver or vehicle documents if driving. Border wait times can change. Allow extra time.",
              scheduled_for: addDays(start, -2)
            }
          : null,
        start
          ? {
              event_type: "currency_payment",
              title: "Currency and payment reminder",
              body:
                crossBorderInfo.currency_change && crossBorderInfo.origin_currency && crossBorderInfo.destination_currency
                  ? `Your trip crosses from ${crossBorderInfo.origin_currency} to ${crossBorderInfo.destination_currency}. Check card foreign transaction fees and carry a backup payment method.`
                  : "Check exchange rates, foreign transaction fees, tolls/parking payment methods, and backup payment options.",
              scheduled_for: addDays(start, -2)
            }
          : null,
        start
          ? {
              event_type: "border_time_buffer",
              title: "Leave extra time for the border",
              body: "Border wait times can change. Allow extra time.",
              scheduled_for: addDays(start, -1)
            }
          : null
      ].filter(Boolean)
    : [];
  const events = [
    start
      ? {
          event_type: "one_week_before",
          title: "One week before your trip",
          body: "Review bookings, documents, weather, and packing list.",
          scheduled_for: addDays(start, -7)
        }
      : null,
    start
      ? {
          event_type: "one_day_before",
          title: "Tomorrow is travel day",
          body: "Charge devices, download maps, confirm check-in times, and pack documents.",
          scheduled_for: addDays(start, -1)
        }
      : null,
    start
      ? {
          event_type: "countdown_24h",
          title: "24-hour countdown",
          body: "Your trip starts soon. Open Roamly for the travel timeline.",
          scheduled_for: addDays(start, -1)
        }
      : null,
    start
      ? {
          event_type: "travel_day_started",
          title: "Travel day started",
          body: "Roamly can show what is next, nearby, and already booked.",
          scheduled_for: startOfTrip(start)
        }
      : null,
    {
      event_type: "document_check",
      title: "Document check",
      body: "Document requirements can change. Verify official government, embassy, airline, and destination sources before travel.",
      scheduled_for: start ? addDays(start, -7) : null
    },
    {
      event_type: "packing_check",
      title: "Packing reminder",
      // An actual reminder, not a description of one (sweep
      // NEW-8): it names the trip and tells the traveller what
      // to do now — pack, with the checklist one tap away.
      body: `Time to pack for ${getTripDestinationLabel(trip) || "your trip"}: work through your packing list, lay out your travel documents, and check your check-in times. Your trip starts in two days.`,
      scheduled_for: start ? addDays(start, -2) : null
    },
    {
      event_type: "country_info",
      title: "Country and city info",
      body: `Review key travel notes for ${getTripDestinationLabel(trip) || "your destination"}.`,
      scheduled_for: start ? addDays(start, -7) : null
    },
    ...crossBorderEvents
  ].filter(Boolean) as Array<{ event_type: string; title: string; body: string; scheduled_for: string | null; dayIndex?: number }>;

  // Travel-day coverage (live fix, 2026-11-06): the base timeline used
  // to end at day 1's travel_day_started, so a trip in its window held
  // no scheduled companion event for any later day — once the pre-trip
  // batch had been consumed, nothing remained for the dispatcher to
  // fire for the rest of the trip. One travel-day event per trip day
  // keeps coverage for the whole window. Days 2+ share day 1's
  // event_type (the widest the production event_type CHECK allows) and
  // carry dayIndex as their dedupe dimension (stamped into metadata as
  // travelDayIndex at insert time).
  if (start && trip.end_date) {
    const spanDays = Math.round((Date.parse(`${trip.end_date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
    const totalDays = Number.isFinite(spanDays) ? Math.min(366, Math.max(1, spanDays + 1)) : 1;
    for (let day = 2; day <= totalDays; day += 1) {
      events.push({
        event_type: "travel_day_started",
        dayIndex: day,
        title: `Travel day ${day}`,
        body: `Day ${day} of your trip. Roamly can show what is next, nearby, and already booked.`,
        scheduled_for: addDays(start, day - 1)
      });
    }
  }

  // Workstream A: booking labels derive from bookingTruth. A booking
  // whose CURRENT truth is cancelled/refunded/superseded/test produces
  // no companion reminder at all — getTripAndBookings already filters
  // cancelled/refunded for the scheduled path, and this guard covers
  // every direct caller of buildPreTripTimeline too.
  // Round 2 Lane E2 judgment: these reminder rows present NO
  // confirmation claim (title = the booking's own title, body =
  // provider + formatted start), so travelerConfirmedOnly bookings
  // keep their reminders unchanged — reminders are the traveler's
  // own schedule, not a verification presentation. The verification
  // framing lives on the Live page's "verified" status, which is
  // providerConfirmationEvidence-only.
  const activeBookings = bookings.filter(
    (booking) => !isInactiveTruthState(bookingTruthState({
      booking_status: booking.booking_status,
      traveler_confirmed: booking.traveler_confirmed,
      confirmation_number: booking.confirmation_number,
      provider_name: booking.provider_name,
      title: booking.title,
      source_type: booking.source_type,
      superseded_by_booking_id: booking.superseded_by_booking_id,
      metadata: booking.metadata
    }))
  );
  const bookingEvents = activeBookings.map((booking) => {
    // Audit fix: the raw ISO start_at was concatenated into the
    // notification body and rendered verbatim on the owner's phone
    // ("Roamly QA Test Provider at 2026-10-29T19:00:00+00:00."). Format
    // the instant for display; an unparseable value is omitted rather
    // than leaked raw.
    const rawStart = booking.start_at || booking.start_time;
    const parsedStart = rawStart ? new Date(rawStart) : null;
    const startLabel =
      parsedStart && !Number.isNaN(parsedStart.getTime())
        ? new Intl.DateTimeFormat("en", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "UTC"
          }).format(parsedStart)
        : null;
    return {
      event_type: booking.booking_type === "hotel" ? "check_in_reminder" : "booking_reminder",
      booking_id: booking.id,
      title: booking.title || `${booking.booking_type} reminder`,
      body: `${booking.provider_name || "Booking"}${startLabel ? ` at ${startLabel}` : ""}.`,
      scheduled_for: bookingReminderTime(booking)
    };
  });

  return [...events, ...bookingEvents];
}

async function getTripAndBookings(supabase: SupabaseClient, tripId: string) {
  const [{ data: trip, error: tripError }, { data: bookings, error: bookingError }] = await Promise.all([
    supabase.from("roamly_trips").select("*").eq("id", tripId).maybeSingle(),
    supabase.from("roamly_bookings").select("*").eq("trip_id", tripId).is("superseded_by_booking_id", null).order("start_at", { ascending: true })
  ]);
  if (tripError) return { trip: null, bookings: [], error: tripError.message };
  if (bookingError) return { trip: trip as CompanionTrip | null, bookings: [], error: bookingError.message };
  const currentBookings = ((bookings || []) as CompanionBooking[]).filter((booking) =>
    trip && isOperationalCurrentBooking(booking) && booking.user_id === trip.user_id && booking.trip_id === tripId &&
      !["cancelled", "refunded"].includes(String(booking.booking_status || "").trim().toLowerCase())
  );
  return { trip: trip as CompanionTrip | null, bookings: currentBookings, error: null };
}

/**
 * Scheduling-refusal record (visibility round 2026-10-31, finding L5).
 * Every refusal/failure of scheduleCompanionEvents is written to the
 * existing roamly_trip_events store via recordTripEvent — queryable by
 * event_type. A locked trip refusing is routine (severity "routine");
 * an UNLOCKED trip failing, or a trip that cannot be loaded, is
 * severity "attention" (unmissable). Recording never changes the
 * scheduling outcome and never throws.
 */
export const COMPANION_SCHEDULING_REFUSED_EVENT = "companion_scheduling_refused";
export const COMPANION_SCHEDULING_FAILED_EVENT = "companion_scheduling_failed";

async function recordCompanionSchedulingOutcome(
  supabase: SupabaseClient,
  input: { tripId: string; userId?: string | null; unlocked: boolean | null; reason: string }
) {
  try {
    const attention = input.unlocked !== false;
    await recordTripEvent(supabase, {
      userId: input.userId || null,
      tripId: input.tripId,
      eventType: attention ? COMPANION_SCHEDULING_FAILED_EVENT : COMPANION_SCHEDULING_REFUSED_EVENT,
      eventTitle: attention ? "Companion scheduling failed" : "Companion scheduling refused (trip locked)",
      eventBody: input.reason,
      metadata: {
        tripId: input.tripId,
        reason: input.reason,
        unlocked: input.unlocked,
        severity: attention ? "attention" : "routine",
        recordedAt: new Date().toISOString()
      }
    });
  } catch {
    // Visibility must never break scheduling.
  }
}

export async function scheduleCompanionEvents(supabase: SupabaseClient, tripId: string) {
  const reader = createSupabaseAdminClient() || supabase;
  const { trip, bookings, error } = await getTripAndBookings(reader, tripId);
  if (error || !trip) {
    const reason = error || "Trip not found.";
    await recordCompanionSchedulingOutcome(reader, { tripId, userId: trip?.user_id || null, unlocked: trip ? tripHasLiveCompanionUnlock(trip) : null, reason });
    return { ok: false, error: reason };
  }
  if (!tripHasLiveCompanionUnlock(trip)) {
    const reason = "Live Trip Companion is not unlocked for this trip.";
    await recordCompanionSchedulingOutcome(reader, { tripId, userId: trip.user_id, unlocked: false, reason });
    return { ok: false, error: reason };
  }

  const timeline = buildPreTripTimeline(trip, bookings);
  const { data: existing } = await reader
    .from("roamly_trip_companion_events")
    .select("id,event_type,booking_id,status,scheduled_for,metadata")
    .eq("trip_id", tripId);
  const currentBookingIds = new Set(bookings.map((booking) => booking.id));
  const staleEventIds = (existing || [])
    .filter((event) => shouldSuppressScheduledBookingEvent({ event, currentBookingIds }))
    .map((event) => event.id)
    .filter((id): id is string => typeof id === "string");
  if (staleEventIds.length) {
    const cancelled = await reader
      .from("roamly_trip_companion_events")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .in("id", staleEventIds)
      .eq("trip_id", tripId)
      .eq("status", "scheduled");
    if (cancelled.error) {
      await recordCompanionSchedulingOutcome(reader, { tripId, userId: trip.user_id, unlocked: true, reason: cancelled.error.message });
      return { ok: false, error: cancelled.error.message };
    }
  }
  // Reconciliation (live fix, 2026-11-06): creation used to be
  // write-once — the dedupe below counted TERMINAL rows (skipped /
  // cancelled) as "already exists", so any event the dispatcher
  // consumed before its day (gate-skipped during a momentary
  // unlock-flag-off window, or retired early) was gone for good, and
  // with the batch ending at day 1 an in-window trip was left with
  // zero future-scheduled events and no path to ever get one. This
  // pass now reconciles the timeline against the trip's remaining
  // window on every call (unlock, booking confirm, Live-page visit):
  //   * live rows (scheduled / processing / shown / completed) always
  //     dedupe — re-running never duplicates an event;
  //   * terminal rows dedupe only the elapsed-day bookkeeping insert
  //     below; they never block re-creating an event whose day is
  //     today or still ahead, so a wrongly killed event heals on the
  //     next reconcile instead of staying dead for the whole trip;
  //   * a past-due event whose day is today (or whose trip has not
  //     started yet) is inserted with its fire time clamped to the
  //     creation instant, so the FIRST dispatcher run that starts
  //     after the row exists claims it as a real delivery through
  //     the normal path. (2026-11-08, Europe/Paris production test:
  //     the earlier ~1-minute cushion was a blind window — the
  //     unlock-to-dispatch gap is shorter than the cushion whenever
  //     generation is fast, so run 1 saw zero due events and the
  //     consolidated reminder only landed in run 2. A row cannot be
  //     "born expired" unseen: the dispatcher only ever fetches
  //     rows that already exist when its run starts.);
  //   * an event whose whole day has elapsed is recorded directly as
  //     skipped (metadata catchUp: "elapsed_day") — honest bookkeeping
  //     that costs no dispatcher cycle and sends nothing.
  // Day indices use the builder's UTC-day convention (09:00Z fire
  // times), matching buildPreTripTimeline.
  const now = new Date();
  const nowMs = now.getTime();
  const utcDayNumber = (value: string) => Math.floor(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / 86_400_000);
  const startDayNumber = trip.start_date ? utcDayNumber(trip.start_date) : null;
  const currentDayIndex = startDayNumber === null ? null : Math.floor(nowMs / 86_400_000) - startDayNumber + 1;
  const dayIndexOf = (iso: string) => (startDayNumber === null ? null : utcDayNumber(iso) - startDayNumber + 1);
  const keyOf = (eventType: string, bookingId: string | null | undefined, dayIndex: number | undefined) =>
    `${eventType}:${bookingId || ""}${dayIndex ? `:day${dayIndex}` : ""}`;
  const storedDayIndex = (event: { metadata?: unknown }) => {
    const md = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
    return typeof md.travelDayIndex === "number" ? md.travelDayIndex : undefined;
  };
  const liveKeys = new Set<string>();
  const terminalKeys = new Set<string>();
  for (const event of existing || []) {
    const key = keyOf(event.event_type, event.booking_id, storedDayIndex(event));
    if (["scheduled", "processing", "shown", "completed"].includes(String(event.status))) liveKeys.add(key);
    else terminalKeys.add(key);
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const event of timeline) {
    const bookingId = "booking_id" in event ? event.booking_id || null : null;
    const dayIndex = "dayIndex" in event ? event.dayIndex : undefined;
    const key = keyOf(event.event_type, bookingId, dayIndex);
    if (liveKeys.has(key)) continue;
    const scheduledFor = event.scheduled_for;
    const parsed = scheduledFor ? Date.parse(scheduledFor) : NaN;
    let status = "scheduled";
    let fireAt = scheduledFor;
    let catchUp: string | null = null;
    if (Number.isFinite(parsed) && parsed <= nowMs) {
      const eventDayIndex = dayIndexOf(scheduledFor as string);
      if (eventDayIndex !== null && currentDayIndex !== null && currentDayIndex >= 1 && eventDayIndex < currentDayIndex) {
        if (terminalKeys.has(key)) continue;
        status = "skipped";
        catchUp = "elapsed_day";
      } else {
        fireAt = new Date(nowMs).toISOString();
        catchUp = "clamped";
      }
    }
    rows.push({
      user_id: trip.user_id,
      trip_id: tripId,
      booking_id: bookingId,
      event_type: event.event_type,
      title: event.title,
      body: event.body,
      scheduled_for: fireAt,
      status,
      ...(status === "skipped" ? { completed_at: now.toISOString() } : {}),
      metadata: {
        generatedBy: "roamly_companion",
        ...(dayIndex ? { travelDayIndex: dayIndex } : {}),
        ...(catchUp ? { catchUp } : {})
      }
    });
    // A key written by this pass (live or bookkeeping) must not be
    // written twice if the timeline itself repeats it.
    liveKeys.add(key);
    terminalKeys.add(key);
  }

  if (rows.length) {
    const inserted = await reader.from("roamly_trip_companion_events").insert(rows);
    if (inserted.error) {
      await recordCompanionSchedulingOutcome(reader, { tripId, userId: trip.user_id, unlocked: true, reason: inserted.error.message });
      return { ok: false, error: inserted.error.message };
    }
  }

  // Round 2, HIGH 4: the country-info set is derived from this trip's
  // own origin/destination countries (one computation, reused here so
  // the stored record, the cross-border flag, and the warnings agree).
  const crossBorderInfo = getCompanionCrossBorderInfo(trip);
  await reader
    .from("roamly_trips")
    .update({
      trip_companion_status:
        trip.trip_companion_status === "active" || trip.trip_companion_status === "completed"
          ? trip.trip_companion_status
          : "scheduled",
      metadata: {
        ...(trip.metadata || {}),
        companion: {
          status: "scheduled",
          travelCountryInfo: {
            ...buildCountryInfo(trip.destination_country, trip.destination_city, {
              originCountry: crossBorderInfo.origin_country,
              crossBorder: crossBorderInfo.cross_border
            }),
            cross_border: crossBorderInfo.cross_border,
            crossBorderWarnings: crossBorderInfo.cross_border
              ? crossBorderTravelNotes({
                  originCurrency: crossBorderInfo.origin_currency,
                  destinationCurrency: crossBorderInfo.destination_currency
                })
              : []
          },
          packingChecklist: buildPackingChecklist(trip),
          documentChecklist: buildDocumentChecklist(trip)
        }
      }
    })
    .eq("id", tripId);

  return { ok: true, count: rows.length };
}

export async function unlockLiveCompanion(
  supabase: SupabaseClient,
  tripId: string,
  source: "paid" | "bundle" | "admin"
) {
  const writer = createSupabaseAdminClient() || supabase;
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await writer
    .from("roamly_trips")
    .select("id,user_id,tracking_unlocked,tracking_unlock_source,tracking_paid_at,live_companion_unlocked,live_companion_unlocked_at,live_companion_source,trip_companion_status")
    .eq("id", tripId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!existing) return { ok: false, error: "Trip not found." };

  const trip = existing as CompanionTrip;
  const shouldRecordUnlock = trip.live_companion_unlocked !== true;
  const companionStatus =
    trip.trip_companion_status === "active" || trip.trip_companion_status === "completed"
      ? trip.trip_companion_status
      : "scheduled";

  const unlockUpdate: Record<string, unknown> = {
    tracking_unlocked: true,
    tracking_unlock_source: source,
    live_companion_unlocked: true,
    live_companion_unlocked_at: trip.live_companion_unlocked_at || now,
    live_companion_source: source,
    trip_companion_status: companionStatus
  };
  if (source !== "admin") unlockUpdate.tracking_paid_at = trip.tracking_paid_at || now;

  const { error } = await writer
    .from("roamly_trips")
    .update(unlockUpdate)
    .eq("id", tripId)
    .eq("user_id", trip.user_id);

  if (error) return { ok: false, error: error.message };

  await scheduleCompanionEvents(writer, tripId);
  if (shouldRecordUnlock) {
    await recordTripEvent(writer, {
      userId: trip.user_id,
      tripId,
      eventType: "live_companion_unlocked",
      eventTitle: "Live Trip Companion unlocked",
      eventBody: "Live Trip Companion is ready for this trip.",
      metadata: { source }
    });
  }
  return { ok: true };
}

export async function getCompanionTimeline(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("*")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  return { events: data || [], error: error?.message || null };
}

export async function getNextCompanionEvent(supabase: SupabaseClient, userId: string, tripId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("*")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .eq("status", "scheduled")
    .gte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();

  return { event: data || null, error: error?.message || null };
}

export async function markCompanionEventShown(supabase: SupabaseClient, userId: string, eventId: string) {
  return supabase
    .from("roamly_trip_companion_events")
    .update({ status: "shown" })
    .eq("id", eventId)
    .eq("user_id", userId);
}

export async function buildTravelDayStatus(supabase: SupabaseClient, userId: string, tripId: string) {
  const [timeline, next] = await Promise.all([
    getCompanionTimeline(supabase, userId, tripId),
    getNextCompanionEvent(supabase, userId, tripId)
  ]);
  return {
    timeline: timeline.events,
    nextEvent: next.event,
    error: timeline.error || next.error
  };
}

export async function buildLiveCompanionSummary(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data: trip } = await supabase
    .from("roamly_trips")
    .select("metadata")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  const status = await buildTravelDayStatus(supabase, userId, tripId);
  return {
    trip,
    timeline: status.timeline,
    nextEvent: status.nextEvent,
    error: status.error
  };
}
