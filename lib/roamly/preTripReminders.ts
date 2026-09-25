import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueCompanionNotification } from "@/lib/roamly/companionNotifications";
import { timezoneFromTripMetadata } from "@/lib/roamly/liveCompanion";
import { schedulePreTrip7DayBriefing } from "@/lib/roamly/preTrip7DayBriefing";
import { schedulePreTrip1DayBriefing } from "@/lib/roamly/preTrip1DayBriefing";
import { scheduleTravelDayBriefing } from "@/lib/roamly/travelDayBriefing";
import { scheduleDailyTripBriefing } from "@/lib/roamly/dailyTripBriefing";

export const PRETRIP_REMINDER_TYPES = [
  "trip_predeparture_7d",
  "trip_predeparture_1d"
] as const;

type PreTripReminderType = (typeof PRETRIP_REMINDER_TYPES)[number];

type TripReminderRow = {
  id: string;
  user_id: string;
  title: string | null;
  destination: string | null;
  destination_name: string | null;
  destination_city: string | null;
  start_date: string | null;
  end_date?: string | null;
  special_notes?: string | null;
  status: string | null;
  itinerary_status?: string | null;
  metadata: Record<string, unknown> | null;
};

type ConfirmedBookingRow = {
  id: string;
  booking_type: string | null;
  booking_status: string | null;
  title: string | null;
  provider_name: string | null;
  confirmation_number: string | null;
  start_at: string | null;
  end_at: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  origin: string | null;
  destination: string | null;
  flight_number: string | null;
  traveler_confirmed: boolean | null;
  updated_at: string | null;
};

const REMINDER_WINDOWS: Record<PreTripReminderType, { days: number; label: string }> = {
  trip_predeparture_7d: { days: 7, label: "One week before travel" },
  trip_predeparture_1d: { days: 1, label: "One day before travel" }
};

export const PRE_TRIP_PROCESSING_PAGE_SIZE = 50;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const PRETRIP_COPY = {
  en: { week: "{destination} is one week away", tomorrow: "{destination} starts tomorrow", departure: "Departure", start: "Trip start", confirmed: "Confirmed", none: "No confirmed bookings are attached yet.", gap: "Still unresolved: {gaps}.", gaps: "confirmed transport, confirmed lodging", review: "Review trip" },
  fr: { week: "Votre voyage à {destination} commence dans une semaine", tomorrow: "Votre voyage à {destination} commence demain", departure: "Départ", start: "Début du voyage", confirmed: "Confirmé", none: "Aucune réservation confirmée n’est encore associée.", gap: "À vérifier : {gaps}.", gaps: "transport confirmé, hébergement confirmé", review: "Vérifier le voyage" },
  es: { week: "Tu viaje a {destination} comienza en una semana", tomorrow: "Tu viaje a {destination} comienza mañana", departure: "Salida", start: "Inicio del viaje", confirmed: "Confirmado", none: "Todavía no hay reservas confirmadas vinculadas.", gap: "Pendiente de resolver: {gaps}.", gaps: "transporte confirmado, alojamiento confirmado", review: "Revisar viaje" },
  ja: { week: "{destination}への旅行まであと1週間です", tomorrow: "{destination}への旅行は明日始まります", departure: "出発", start: "旅行開始", confirmed: "確定済み", none: "確定済みの予約はまだ登録されていません。", gap: "未解決の項目：{gaps}。", gaps: "確定済みの交通、確定済みの宿泊", review: "旅行を確認" },
  ko: { week: "{destination} 여행이 일주일 남았습니다", tomorrow: "{destination} 여행이 내일 시작됩니다", departure: "출발", start: "여행 시작", confirmed: "확정됨", none: "아직 확정된 예약이 연결되어 있지 않습니다.", gap: "아직 해결되지 않은 항목: {gaps}.", gaps: "확정된 교통편, 확정된 숙박", review: "여행 검토" },
  zh: { week: "距离前往{destination}还有一周", tomorrow: "前往{destination}的行程明天开始", departure: "出发", start: "行程开始", confirmed: "已确认", none: "目前还没有关联已确认的预订。", gap: "尚待处理：{gaps}。", gaps: "已确认交通、已确认住宿", review: "查看行程" }
} as const;

function reminderCopy(locale: string, key: keyof typeof PRETRIP_COPY.en, values: Record<string, string> = {}) {
  let result: string = PRETRIP_COPY[locale as keyof typeof PRETRIP_COPY]?.[key] || PRETRIP_COPY.en[key];
  for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{${name}}`, value);
  return result;
}

function reminderLocale(trip: TripReminderRow) {
  const metadata = tripMetadataRecord(trip);
  const planning = metadata.planning && typeof metadata.planning === "object" && !Array.isArray(metadata.planning)
    ? metadata.planning as Record<string, unknown>
    : {};
  const generated = metadata.generatedItinerary && typeof metadata.generatedItinerary === "object" && !Array.isArray(metadata.generatedItinerary)
    ? metadata.generatedItinerary as Record<string, unknown>
    : {};
  const raw = (typeof generated.language === "string" ? generated.language : typeof planning.language === "string" ? planning.language : "en").toLowerCase().split(/[-_]/)[0];
  return raw in PRETRIP_COPY ? raw : "en";
}

function datePartsInZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute")
  };
}

export function zonedDateTimeToUtc(dateIso: string, minutes: number, timezone: string) {
  const [year, month, day] = dateIso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const actualLocal = datePartsInZone(utcGuess, timezone);
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  const actual = Date.UTC(
    actualLocal.year,
    actualLocal.month - 1,
    actualLocal.day,
    actualLocal.hour,
    actualLocal.minute
  );
  return new Date(utcGuess.getTime() + (intended - actual));
}

function validDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function tripMetadataRecord(trip: TripReminderRow) {
  return trip.metadata && typeof trip.metadata === "object" && !Array.isArray(trip.metadata)
    ? trip.metadata
    : {};
}

function tripDestination(trip: TripReminderRow) {
  return clean(trip.destination_name) || clean(trip.destination_city) || clean(trip.destination) || clean(trip.title) || "your trip";
}

function activeConfirmedBooking(booking: ConfirmedBookingRow) {
  return (
    booking.traveler_confirmed === true &&
    ["booked", "paid", "reserved"].includes(clean(booking.booking_status)) &&
    clean(booking.booking_status) !== "cancelled"
  );
}

function bookingTime(booking: ConfirmedBookingRow) {
  return validDate(booking.start_at) || validDate(booking.check_in_at);
}

export function tripStartInstant(params: {
  trip: TripReminderRow;
  confirmedBookings: ConfirmedBookingRow[];
}) {
  const timezone = timezoneFromTripMetadata(tripMetadataRecord(params.trip), "UTC");
  const firstConfirmedBooking = params.confirmedBookings
    .filter(activeConfirmedBooking)
    .map((booking) => ({ booking, start: bookingTime(booking) }))
    .filter((item): item is { booking: ConfirmedBookingRow; start: Date } => Boolean(item.start))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  if (firstConfirmedBooking) {
    return {
      start: firstConfirmedBooking.start,
      timezone,
      source: "confirmed_booking" as const
    };
  }

  const startDate = clean(params.trip.start_date);
  const fallbackStart = startDate ? zonedDateTimeToUtc(startDate, 9 * 60, timezone) : null;
  return fallbackStart
    ? {
        start: fallbackStart,
        timezone,
        source: "trip_start_date" as const
      }
    : null;
}

function formatBookingLine(booking: ConfirmedBookingRow, timezone: string, locale: string) {
  const type = clean(booking.booking_type);
  const title = clean(booking.title) || clean(booking.provider_name) || "Confirmed booking";
  const provider = clean(booking.provider_name);
  const flight = clean(booking.flight_number);
  const start = bookingTime(booking);
  const when = start
    ? new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(start)
    : "";
  return [type, title, provider, flight, when].filter(Boolean).join(" - ");
}

export function preTripReminderVersion(params: {
  trip: TripReminderRow;
  confirmedBookings: ConfirmedBookingRow[];
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      tripId: params.trip.id,
      startDate: params.trip.start_date,
      timezone: timezoneFromTripMetadata(tripMetadataRecord(params.trip), "UTC"),
      bookings: params.confirmedBookings
        .filter(activeConfirmedBooking)
        .map((booking) => ({
          id: booking.id,
          type: booking.booking_type,
          status: booking.booking_status,
          startAt: booking.start_at,
          checkInAt: booking.check_in_at,
          updatedAt: booking.updated_at
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    }))
    .digest("hex")
    .slice(0, 24);
}

export function duePreTripReminderTypes(params: {
  tripStart: Date;
  now: Date;
}) {
  return PRETRIP_REMINDER_TYPES.filter((type) => {
    const scheduled = new Date(params.tripStart.getTime() - REMINDER_WINDOWS[type].days * 24 * 60 * 60 * 1000);
    const graceMs = type === "trip_predeparture_7d" ? 36 * 60 * 60 * 1000 : params.tripStart.getTime() - scheduled.getTime();
    return params.now.getTime() >= scheduled.getTime() && params.now.getTime() < scheduled.getTime() + graceMs;
  });
}

export function buildPreTripReminderContent(params: {
  trip: TripReminderRow;
  type: PreTripReminderType;
  tripStart: Date;
  timezone: string;
  confirmedBookings: ConfirmedBookingRow[];
}) {
  const destination = tripDestination(params.trip);
  const locale = reminderLocale(params.trip);
  const isWeek = params.type === "trip_predeparture_7d";
  const startLabel = new Intl.DateTimeFormat(locale, {
    timeZone: params.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(params.tripStart);
  const activeBookings = params.confirmedBookings
    .filter(activeConfirmedBooking)
    .filter((booking) => clean(booking.booking_status) !== "cancelled")
    .sort((a, b) => (bookingTime(a)?.getTime() || 0) - (bookingTime(b)?.getTime() || 0));
  const highlights = activeBookings.slice(0, 4).map((booking) => formatBookingLine(booking, params.timezone, locale));
  const gaps = [
    !activeBookings.some((booking) => ["flight", "transport"].includes(clean(booking.booking_type))) ? reminderCopy(locale, "gaps").split(/, |，|、/)[0] : "",
    !activeBookings.some((booking) => clean(booking.booking_type) === "hotel") ? reminderCopy(locale, "gaps").split(/, |，|、/)[1] : ""
  ].filter(Boolean);

  return {
    title:
      reminderCopy(locale, isWeek ? "week" : "tomorrow", { destination }),
    body: [
      `${reminderCopy(locale, isWeek ? "start" : "departure")}: ${startLabel}.`,
      highlights.length ? `${reminderCopy(locale, "confirmed")}: ${highlights.join("; ")}.` : reminderCopy(locale, "none"),
      gaps.length ? reminderCopy(locale, "gap", { gaps: gaps.join(", ") }) : ""
    ].filter(Boolean).join(" "),
    actionLabel: reminderCopy(locale, "review"),
    actionUrl: `/trip/${params.trip.id}/live`
  };
}

async function loadConfirmedBookings(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
}) {
  const { data, error } = await params.supabase
    .from("roamly_bookings")
    .select("id,booking_type,booking_status,title,provider_name,confirmation_number,start_at,end_at,check_in_at,check_out_at,origin,destination,flight_number,traveler_confirmed,updated_at")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .is("superseded_by_booking_id", null)
    .order("start_at", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return (data || []) as ConfirmedBookingRow[];
}

async function reminderEventExists(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  type: PreTripReminderType;
  reminderKey: string;
}) {
  const { data, error } = await params.supabase
    .from("roamly_trip_companion_events")
    .select("id,status")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .eq("event_type", params.type)
    .contains("metadata", { reminder_key: params.reminderKey })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? String(data.id) : null;
}

async function scheduleSingleReminder(params: {
  supabase: SupabaseClient;
  trip: TripReminderRow;
  type: PreTripReminderType;
  tripStart: Date;
  timezone: string;
  confirmedBookings: ConfirmedBookingRow[];
  version: string;
}) {
  const reminderKey = `${params.trip.id}:${params.type}:${params.version}`;
  const existingEventId = await reminderEventExists({
    supabase: params.supabase,
    userId: params.trip.user_id,
    tripId: params.trip.id,
    type: params.type,
    reminderKey
  });
  if (existingEventId) return { scheduled: false, deduplicated: true, eventId: existingEventId };

  const content = buildPreTripReminderContent(params);
  const scheduledFor = new Date(
    params.tripStart.getTime() -
      REMINDER_WINDOWS[params.type].days * 24 * 60 * 60 * 1000
  ).toISOString();

  const delivery = await queueCompanionNotification({
    supabase: params.supabase,
    userId: params.trip.user_id,
    tripId: params.trip.id,
    type: params.type,
    priority: params.type === "trip_predeparture_1d" ? "important" : "routine",
    title: content.title,
    body: content.body,
    actionLabel: content.actionLabel,
    actionUrl: content.actionUrl,
    scheduledFor,
    metadata: {
      reminder_key: reminderKey,
      reminder_version: params.version,
      send_email: true,
      confirmed_booking_ids: params.confirmedBookings
        .filter(activeConfirmedBooking)
        .map((booking) => booking.id)
    },
    dedupeParts: [reminderKey]
  });

  if (!delivery.ok) throw new Error(delivery.error);

  const insert = await params.supabase
    .from("roamly_trip_companion_events")
    .insert({
      user_id: params.trip.user_id,
      trip_id: params.trip.id,
      event_type: params.type,
      title: content.title,
      body: content.body,
      scheduled_for: scheduledFor,
      completed_at: new Date().toISOString(),
      status: "completed",
      metadata: {
        reminder_key: reminderKey,
        reminder_version: params.version,
        reminder_label: REMINDER_WINDOWS[params.type].label,
        trip_start_at: params.tripStart.toISOString(),
        trip_start_timezone: params.timezone,
        trip_start_source: tripStartInstant({
          trip: params.trip,
          confirmedBookings: params.confirmedBookings
        })?.source || "unknown",
        confirmed_booking_ids: params.confirmedBookings
          .filter(activeConfirmedBooking)
          .map((booking) => booking.id)
      }
    })
    .select("id")
    .single();

  if (insert.error) throw new Error(insert.error.message);

  return {
    scheduled: true,
    deduplicated: delivery.deduplicated === true,
    eventId: String(insert.data.id),
    deliveryId: delivery.delivery?.id ? String(delivery.delivery.id) : null
  };
}

export async function schedulePreTripReminders(params?: {
  supabase?: SupabaseClient;
  now?: Date;
}) {
  const supabase = params?.supabase || createSupabaseAdminClient();
  if (!supabase) return { ok: false as const, error: "Supabase service role is not configured." };

  const now = params?.now || new Date();
  const startLower = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startUpper = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const results = [];
  let cursor: { startDate: string; id: string } | null = null;
  let processedTrips = 0;

  for (;;) {
    const query = supabase
      .from("roamly_trips")
      .select("id,user_id,title,destination,destination_name,destination_city,start_date,end_date,special_notes,status,itinerary_status,metadata")
      .not("start_date", "is", null)
      .lte("start_date", startUpper)
      .or(cursor
        ? `and(or(end_date.gte.${startLower},start_date.gte.${startLower}),or(start_date.gt.${cursor.startDate},and(start_date.eq.${cursor.startDate},id.gt.${cursor.id})))`
        : `end_date.gte.${startLower},start_date.gte.${startLower}`)
      .neq("status", "archived")
      .neq("status", "cancelled")
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })
      .range(0, PRE_TRIP_PROCESSING_PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) return { ok: false as const, error: error.message, processedTrips, results };
    const page = (data || []) as TripReminderRow[];
    if (!page.length) break;

    for (const trip of page) {
      processedTrips += 1;
      try {
        const confirmedBookings = await loadConfirmedBookings({
          supabase,
          tripId: trip.id,
          userId: trip.user_id
        });
        const start = tripStartInstant({ trip, confirmedBookings });
        if (!start) continue;
        const version = preTripReminderVersion({ trip, confirmedBookings });
        const dueTypes = duePreTripReminderTypes({
          tripStart: start.start,
          now
        }).filter((type) => !["trip_predeparture_7d", "trip_predeparture_1d"].includes(type));
        results.push({
          tripId: trip.id,
          type: "trip_predeparture_7d",
          result: await schedulePreTrip7DayBriefing({
            supabase,
            trip,
            confirmedBookings,
            now
          })
        });
        results.push({
          tripId: trip.id,
          type: "trip_predeparture_1d",
          result: await schedulePreTrip1DayBriefing({
            supabase,
            trip,
            bookings: confirmedBookings,
            now
          })
        });
        results.push({
          tripId: trip.id,
          type: "travel_day",
          result: await scheduleTravelDayBriefing({
            supabase,
            trip,
            bookings: confirmedBookings,
            now
          })
        });
        results.push({
          tripId: trip.id,
          type: "daily_trip_briefing",
          result: await scheduleDailyTripBriefing({
            supabase,
            trip,
            bookings: confirmedBookings,
            now
          })
        });
        for (const type of dueTypes) {
          results.push({
            tripId: trip.id,
            type,
            result: await scheduleSingleReminder({
              supabase,
              trip,
              type,
              tripStart: start.start,
              timezone: start.timezone,
              confirmedBookings,
              version
            })
          });
        }
      } catch (error) {
        results.push({
          tripId: trip.id,
          error: error instanceof Error ? error.message : "Pre-trip reminder scheduling failed."
        });
      }
    }

    const last = page[page.length - 1];
    if (!last.start_date || !last.id || (cursor && cursor.startDate === last.start_date && cursor.id === last.id)) {
      return { ok: false as const, error: "Pre-trip reminder pagination cursor did not advance.", processedTrips, results };
    }
    cursor = { startDate: last.start_date, id: last.id };
    if (page.length < PRE_TRIP_PROCESSING_PAGE_SIZE) break;
  }

  const failures = results.filter((result) => "error" in result).length;
  const scheduledResults = results.filter((result) => "result" in result);
  return {
    ok: failures === 0,
    processedTrips,
    scheduled: scheduledResults.filter((result) => "result" in result && result.result?.scheduled).length,
    deduplicated: scheduledResults.filter((result) => "result" in result && result.result && "deduplicated" in result.result && result.result.deduplicated === true).length,
    failures,
    results
  };
}
