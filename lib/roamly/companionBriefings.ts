import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueCompanionNotification } from "@/lib/roamly/companionNotifications";
import { getTripItineraryLanguage } from "@/lib/roamly/itineraryTranslations";
import { companionBriefingMessage as msg } from "@/lib/roamly/briefingMessages.mjs";
import type { RoamlyLocale } from "@/lib/i18n";

type TripRow = {
  id: string;
  user_id: string;
  title: string | null;
  destination: string | null;
  destination_name: string | null;
  destination_city: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  timezone?: string | null;
  metadata?: Record<string, unknown> | null;
};

type BookingRow = {
  id: string;
  booking_type: string;
  booking_status: string;
  title: string | null;
  provider_name: string | null;
  start_at: string | null;
  end_at: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  flight_number: string | null;
  terminal: string | null;
  gate: string | null;
};

const MAX_TRIPS_PER_RUN = 100;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function tripTimezone(trip: TripRow): string {
  const metadata = objectValue(trip.metadata);

  return (
    textValue(trip.timezone) ||
    textValue(metadata.timezone) ||
    "UTC"
  );
}

function dateInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function timeInTimezone(
  value: string | null,
  timezone: string,
  locale: string
): string | null {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function destinationLabel(trip: TripRow): string {
  return (
    trip.destination_name ||
    trip.destination_city ||
    trip.destination ||
    trip.title ||
    "your trip"
  );
}

function isActiveBooking(status: string): boolean {
  return ["booked", "paid", "reserved"].includes(status);
}

function bookingLine(
  booking: BookingRow,
  timezone: string,
  locale: string
): string {
  const title =
    booking.title ||
    booking.flight_number ||
    booking.provider_name ||
    booking.booking_type;

  const start =
    booking.check_in_at ||
    booking.start_at;

  const time = timeInTimezone(start, timezone, locale);
  const labels: Record<string, { terminal: string; gate: string }> = {
    fr: { terminal: "Terminal", gate: "Porte" }, es: { terminal: "Terminal", gate: "Puerta" }, ja: { terminal: "ターミナル", gate: "ゲート" }, ko: { terminal: "터미널", gate: "게이트" }, zh: { terminal: "航站楼", gate: "登机口" }
  };
  const localizedLabels = labels[locale] || { terminal: "Terminal", gate: "Gate" };

  const gateDetails = [
    booking.terminal
      ? `${localizedLabels.terminal} ${booking.terminal}`
      : null,
    booking.gate
      ? `${localizedLabels.gate} ${booking.gate}`
      : null
  ]
    .filter(Boolean)
    .join(", ");

  return [
    time ? `${time} — ${title}` : title,
    gateDetails || null
  ]
    .filter(Boolean)
    .join(" · ");
}

async function loadTripBookings(
  supabase: SupabaseClient,
  tripId: string,
  today: string,
  timezone: string
): Promise<BookingRow[]> {
  const result = await supabase
    .from("roamly_bookings")
    .select(
      "id,booking_type,booking_status,title,provider_name,start_at,end_at,check_in_at,check_out_at,flight_number,terminal,gate"
    )
    .eq("trip_id", tripId)
    .is("superseded_by_booking_id", null)
    .in("booking_status", [
      "booked",
      "paid",
      "reserved"
    ])
    .order("start_at", {
      ascending: true,
      nullsFirst: false
    });

  if (result.error) return [];

  return ((result.data || []) as BookingRow[]).filter(
    (booking) => {
      if (!isActiveBooking(booking.booking_status)) {
        return false;
      }

      const relevantAt =
        booking.check_in_at ||
        booking.start_at ||
        booking.check_out_at ||
        booking.end_at;

      if (!relevantAt) return true;

      return (
        dateInTimezone(
          new Date(relevantAt),
          timezone
        ) === today
      );
    }
  );
}

async function unresolvedRepairCount(
  supabase: SupabaseClient,
  tripId: string
): Promise<number> {
  const result = await supabase
    .from("companion_repair_proposals")
    .select("id,status")
    .eq("trip_id", tripId);

  if (result.error) return 0;

  return (result.data || []).filter((row) => {
    const record = objectValue(row);
    const status =
      textValue(record.status)?.toLowerCase() ||
      "";

    return ![
      "approved",
      "applied",
      "rejected",
      "resolved",
      "completed"
    ].includes(status);
  }).length;
}

function dailyBriefingBody(params: {
  trip: TripRow;
  bookings: BookingRow[];
  repairCount: number;
  timezone: string;
  locale: RoamlyLocale;
}) {
  const { trip, bookings, repairCount, timezone, locale } =
    params;

  const lines = bookings
    .slice(0, 5)
    .map((booking) =>
      bookingLine(booking, timezone, locale)
    );

  const sections = [
    msg(locale, "dailyIntro", { destination: destinationLabel(trip) }),
    lines.length ? msg(locale, "dailyItems", { items: lines.join("; ") }) : msg(locale, "dailyNone"),
    repairCount > 0 ? msg(locale, repairCount === 1 ? "repairOne" : "repairMany", { count: String(repairCount) }) : msg(locale, "repairNone"),
    msg(locale, "dailyEnd")
  ];

  return sections.join(" ");
}

function finalDayBriefingBody(params: {
  trip: TripRow;
  bookings: BookingRow[];
  repairCount: number;
  timezone: string;
  locale: RoamlyLocale;
}) {
  const { trip, bookings, repairCount, timezone, locale } =
    params;

  const remaining = bookings
    .slice(0, 5)
    .map((booking) =>
      bookingLine(booking, timezone, locale)
    );

  const sections = [
    msg(locale, "finalIntro", { destination: destinationLabel(trip) }),
    remaining.length ? msg(locale, "finalItems", { items: remaining.join("; ") }) : msg(locale, "finalNone"),
    repairCount > 0 ? msg(locale, repairCount === 1 ? "finalRepairOne" : "finalRepairMany", { count: String(repairCount) }) : msg(locale, "repairNone"),
    msg(locale, "finalEnd")
  ];

  return sections.join(" ");
}

export async function scheduleCompanionBriefings() {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      ok: false as const,
      error: "Supabase service role is not configured."
    };
  }

  const todayUtc = new Date()
    .toISOString()
    .slice(0, 10);

  const tripsResult = await admin
    .from("roamly_trips")
    .select("*")
    .neq("status", "archived")
    .lte("start_date", todayUtc)
    .gte("end_date", todayUtc)
    .order("start_date", {
      ascending: true
    })
    .limit(MAX_TRIPS_PER_RUN);

  if (tripsResult.error) {
    return {
      ok: false as const,
      error: tripsResult.error.message
    };
  }

  const results: Array<{
    tripId: string;
    localDate: string;
    type: "daily_briefing" | "final_day_briefing";
    queued: boolean;
    deduplicated: boolean;
    error: string | null;
  }> = [];

  for (const rawTrip of tripsResult.data || []) {
    const trip = rawTrip as TripRow;

    if (
      !trip.id ||
      !trip.user_id ||
      !trip.start_date ||
      !trip.end_date
    ) {
      continue;
    }

    const timezone = tripTimezone(trip);
    const locale = getTripItineraryLanguage(trip.metadata);
    const localDate = dateInTimezone(
      new Date(),
      timezone
    );

    if (
      localDate < trip.start_date ||
      localDate > trip.end_date
    ) {
      continue;
    }

    const bookings = await loadTripBookings(
      admin,
      trip.id,
      localDate,
      timezone
    );

    const repairCount =
      await unresolvedRepairCount(
        admin,
        trip.id
      );

    const finalDay =
      localDate === trip.end_date;

    const type = finalDay
      ? ("final_day_briefing" as const)
      : ("daily_briefing" as const);

    const title = msg(locale, finalDay ? "finalTitle" : "dailyTitle", { destination: destinationLabel(trip) });

    const body = finalDay
      ? finalDayBriefingBody({
          trip,
          bookings,
          repairCount,
          timezone,
          locale
        })
      : dailyBriefingBody({
          trip,
          bookings,
          repairCount,
          timezone,
          locale
        });

    const queued =
      await queueCompanionNotification({
        supabase: admin,
        userId: trip.user_id,
        tripId: trip.id,
        type,
        priority: "routine",
        title,
        body,
        actionLabel: finalDay
          ? "Review final day"
          : "Open today’s trip",
        actionUrl: `/trip/${trip.id}/live`,
        metadata: {
          briefingDate: localDate,
          timezone,
          finalDay,
          bookingCount: bookings.length,
          unresolvedRepairCount:
            repairCount
        },
        dedupeParts: [
          "companion_briefing",
          trip.id,
          localDate,
          type
        ]
      });

    results.push({
      tripId: trip.id,
      localDate,
      type,
      queued: queued.ok,
      deduplicated:
        queued.ok &&
        queued.deduplicated === true,
      error:
        queued.ok
          ? null
          : queued.error
    });
  }

  const failures = results.filter(
    (result) => !result.queued
  ).length;

  return {
    ok: failures === 0,
    tripsEvaluated:
      tripsResult.data?.length || 0,
    briefingsProcessed: results.length,
    failures,
    results
  };
}
