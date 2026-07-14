import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueCompanionNotification } from "@/lib/roamly/companionNotifications";

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
  timezone: string
): string | null {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  try {
    return new Intl.DateTimeFormat("en-CA", {
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
  timezone: string
): string {
  const title =
    booking.title ||
    booking.flight_number ||
    booking.provider_name ||
    booking.booking_type;

  const start =
    booking.check_in_at ||
    booking.start_at;

  const time = timeInTimezone(start, timezone);

  const gateDetails = [
    booking.terminal
      ? `Terminal ${booking.terminal}`
      : null,
    booking.gate
      ? `Gate ${booking.gate}`
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
}) {
  const { trip, bookings, repairCount, timezone } =
    params;

  const lines = bookings
    .slice(0, 5)
    .map((booking) =>
      bookingLine(booking, timezone)
    );

  const sections = [
    `Good morning. Here is your Companion briefing for ${destinationLabel(trip)}.`,
    lines.length
      ? `Today’s confirmed bookings: ${lines.join("; ")}.`
      : "No confirmed timed bookings are scheduled for today.",
    repairCount > 0
      ? `${repairCount} Companion repair ${
          repairCount === 1 ? "proposal needs" : "proposals need"
        } your attention.`
      : "There are no unresolved Companion repairs.",
    "Open the trip for your full itinerary and latest live updates."
  ];

  return sections.join(" ");
}

function finalDayBriefingBody(params: {
  trip: TripRow;
  bookings: BookingRow[];
  repairCount: number;
  timezone: string;
}) {
  const { trip, bookings, repairCount, timezone } =
    params;

  const remaining = bookings
    .slice(0, 5)
    .map((booking) =>
      bookingLine(booking, timezone)
    );

  const sections = [
    `This is the final-day briefing for ${destinationLabel(trip)}.`,
    remaining.length
      ? `Remaining confirmed plans: ${remaining.join("; ")}.`
      : "No remaining confirmed timed bookings were found for today.",
    repairCount > 0
      ? `${repairCount} unresolved Companion repair ${
          repairCount === 1 ? "still needs" : "proposals still need"
        } attention.`
      : "There are no unresolved Companion repairs.",
    "Check checkout details, return transportation, and anything you still need to complete before the trip ends."
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

    const title = finalDay
      ? `Final-day briefing: ${destinationLabel(trip)}`
      : `Today in ${destinationLabel(trip)}`;

    const body = finalDay
      ? finalDayBriefingBody({
          trip,
          bookings,
          repairCount,
          timezone
        })
      : dailyBriefingBody({
          trip,
          bookings,
          repairCount,
          timezone
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
