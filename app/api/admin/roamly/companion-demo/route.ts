import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { processCompanionBookingChange } from "@/lib/roamly/companionOrchestrator";
import {
  queueCompanionNotification,
  sendCompanionNotificationDelivery
} from "@/lib/roamly/companionNotifications";

type DemoAction =
  | "send_test_email"
  | "simulate_delay"
  | "simulate_cancellation"
  | "simulate_gate_change"
  | "simulate_hotel_change";

type DemoBody = {
  action?: DemoAction;
  tripId?: string | null;
  bookingId?: string | null;
};

type BookingRow = {
  id: string;
  user_id: string;
  trip_id: string | null;
  booking_type: string;
  booking_status: string;
  title: string | null;
  flight_number: string | null;
  provider_name: string | null;
  start_at: string | null;
  end_at: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  gate: string | null;
  terminal: string | null;
  updated_at: string | null;
};

function addMinutes(
  value: string | null,
  minutes: number
) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(
    date.getTime() + minutes * 60_000
  ).toISOString();
}

async function sendBasicTestEmail(params: {
  admin: SupabaseClient;
  userId: string;
  tripId?: string | null;
}) {
  const queued =
    await queueCompanionNotification({
      supabase: params.admin,
      userId: params.userId,
      tripId: params.tripId || null,
      type: "booking_confirmed",
      priority: "routine",
      title: "Roamly Companion test email",
      body:
        "This is a controlled end-to-end test of the real Companion notification pipeline.",
      actionLabel: "Open Companion Demo",
      actionUrl: "/admin/companion-demo",
      isTest: true,
      metadata: {
        demoMode: true,
        action: "send_test_email"
      },
      dedupeParts: [
        "companion_demo_email",
        new Date().toISOString()
      ]
    });

  if (!queued.ok) {
    return {
      ok: false as const,
      error: queued.error
    };
  }

  const delivery =
    await sendCompanionNotificationDelivery(
      queued.delivery.id as string
    );

  return {
    ok: delivery.ok,
    deliveryId: queued.delivery.id,
    delivery
  };
}

export async function GET() {
  const guard = await requireRoamlyAdmin();

  if (!guard.ok) {
    return guard.response;
  }

  const tripsResult = await guard.admin
    .from("roamly_trips")
    .select(
      "id,title,destination,start_date,end_date,status"
    )
    .eq("user_id", guard.user.id)
    .order("start_date", {
      ascending: false
    })
    .limit(50);

  if (tripsResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: tripsResult.error.message
      },
      { status: 500 }
    );
  }

  const tripIds = (tripsResult.data || [])
    .map((trip) => trip.id)
    .filter(Boolean);

  const bookingsResult = tripIds.length
    ? await guard.admin
        .from("roamly_bookings")
        .select(
          [
            "id",
            "trip_id",
            "booking_type",
            "booking_status",
            "title",
            "flight_number",
            "provider_name",
            "start_at",
            "end_at",
            "gate",
            "terminal"
          ].join(",")
        )
        .eq("user_id", guard.user.id)
        .in("trip_id", tripIds)
        .order("start_at", {
          ascending: true,
          nullsFirst: false
        })
    : {
        data: [],
        error: null
      };

  if (bookingsResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: bookingsResult.error.message
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    trips: tripsResult.data || [],
    bookings: bookingsResult.data || []
  });
}

export async function POST(
  request: NextRequest
) {
  const guard = await requireRoamlyAdmin();

  if (!guard.ok) {
    return guard.response;
  }

  let body: DemoBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid JSON body."
      },
      { status: 400 }
    );
  }

  if (
    !body.action ||
    ![
      "send_test_email",
      "simulate_delay",
      "simulate_cancellation",
      "simulate_gate_change",
      "simulate_hotel_change"
    ].includes(body.action)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unsupported demo action."
      },
      { status: 400 }
    );
  }

  if (
    body.action === "send_test_email"
  ) {
    const result = await sendBasicTestEmail({
      admin: guard.admin,
      userId: guard.user.id,
      tripId: body.tripId || null
    });

    return NextResponse.json(result, {
      status: result.ok ? 200 : 502
    });
  }

  if (!body.tripId || !body.bookingId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Trip and booking selections are required for this simulation."
      },
      { status: 400 }
    );
  }

  const bookingResult = await guard.admin
    .from("roamly_bookings")
    .select("*")
    .eq("id", body.bookingId)
    .eq("trip_id", body.tripId)
    .eq("user_id", guard.user.id)
    .maybeSingle();

  if (bookingResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: bookingResult.error.message
      },
      { status: 500 }
    );
  }

  if (!bookingResult.data) {
    return NextResponse.json(
      {
        ok: false,
        error: "Booking was not found."
      },
      { status: 404 }
    );
  }

  const booking =
    bookingResult.data as BookingRow;

  const original = {
    booking_status: booking.booking_status,
    start_at: booking.start_at,
    end_at: booking.end_at,
    check_in_at: booking.check_in_at,
    check_out_at: booking.check_out_at,
    gate: booking.gate,
    terminal: booking.terminal
  };

  let eventType:
    | "flight_delayed"
    | "flight_cancelled"
    | "flight_time_changed"
    | "hotel_changed"
    | "booking_updated";

  let severity:
    | "routine"
    | "important"
    | "critical";

  let title: string;
  let summary: string;
  let updatePayload:
    Record<string, unknown>;

  const label =
    booking.title ||
    booking.flight_number ||
    booking.provider_name ||
    "Selected booking";

  if (
    body.action === "simulate_delay"
  ) {
    if (
      booking.booking_type !== "flight"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The two-hour delay simulation requires a flight booking."
        },
        { status: 409 }
      );
    }

    eventType = "flight_delayed";
    severity = "important";
    title = `[TEST] ${label} delayed by 2 hours`;
    summary =
      "Demo Mode simulated a two-hour flight delay and ran the real Companion impact and repair workflow.";

    updatePayload = {
      start_at: addMinutes(
        booking.start_at,
        120
      ),
      end_at: addMinutes(
        booking.end_at,
        120
      )
    };
  } else if (
    body.action ===
    "simulate_cancellation"
  ) {
    eventType =
      booking.booking_type === "flight"
        ? "flight_cancelled"
        : "booking_updated";

    severity = "critical";
    title = `[TEST] ${label} cancelled`;
    summary =
      "Demo Mode simulated a booking cancellation and ran the real Companion impact and repair workflow.";

    updatePayload = {
      booking_status: "cancelled"
    };
  } else if (
    body.action ===
    "simulate_gate_change"
  ) {
    if (
      booking.booking_type !== "flight"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The gate-change simulation requires a flight booking."
        },
        { status: 409 }
      );
    }

    eventType =
      "flight_time_changed";
    severity = "important";
    title = `[TEST] ${label} gate changed`;
    summary =
      "Demo Mode simulated a gate and terminal change and ran the real Companion workflow.";

    updatePayload = {
      gate:
        booking.gate === "B12"
          ? "C24"
          : "B12",
      terminal:
        booking.terminal === "2"
          ? "1"
          : "2"
    };
  } else {
    if (
      booking.booking_type !== "hotel"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The hotel-date simulation requires a hotel booking."
        },
        { status: 409 }
      );
    }

    eventType = "hotel_changed";
    severity = "important";
    title = `[TEST] ${label} dates changed`;
    summary =
      "Demo Mode simulated a hotel date change and ran the real Companion impact and repair workflow.";

    updatePayload = {
      start_at: addMinutes(
        booking.start_at,
        24 * 60
      ),
      end_at: addMinutes(
        booking.end_at,
        24 * 60
      ),
      check_in_at: addMinutes(
        booking.check_in_at,
        24 * 60
      ),
      check_out_at: addMinutes(
        booking.check_out_at,
        24 * 60
      )
    };
  }

  const changedResult = await guard.admin
    .from("roamly_bookings")
    .update({
      ...updatePayload,
      updated_at: new Date().toISOString()
    })
    .eq("id", booking.id)
    .eq("user_id", guard.user.id)
    .select("*")
    .single();

  if (changedResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: changedResult.error.message
      },
      { status: 500 }
    );
  }

  let workflow:
    Awaited<
      ReturnType<
        typeof processCompanionBookingChange
      >
    > | null = null;

  let restoreError: string | null = null;

  try {
    workflow =
      await processCompanionBookingChange({
        supabase: guard.admin,
        userId: guard.user.id,
        tripId: body.tripId,
        bookingId: booking.id,
        eventType,
        severity,
        title,
        summary,
        oldValue: booking,
        newValue:
          changedResult.data as Record<
            string,
            unknown
          >,
        source: "companion_demo_mode",
        effectiveAt:
          new Date().toISOString(),
        affectedLayers: [
          "booking_wallet",
          "itinerary",
          "live_companion",
          "demo_mode"
        ],
        requiresUserApproval: true,
        fingerprintParts: [
          "demo",
          body.action,
          booking.id,
          new Date().toISOString()
        ]
      });

    if (
      workflow.ok &&
      workflow.notification.ok
    ) {
      const deliveryId =
        workflow.notification.delivery
          .id as string;

      await guard.admin
        .from(
          "roamly_companion_notification_deliveries"
        )
        .update({
          is_test: true,
          metadata_json: {
            demoMode: true,
            demoAction: body.action,
            bookingRestored: true
          }
        })
        .eq("id", deliveryId);

      await sendCompanionNotificationDelivery(
        deliveryId
      );
    }
  } finally {
    const restoreResult =
      await guard.admin
        .from("roamly_bookings")
        .update({
          ...original,
          updated_at:
            new Date().toISOString()
        })
        .eq("id", booking.id)
        .eq("user_id", guard.user.id);

    restoreError =
      restoreResult.error?.message ||
      null;
  }

  return NextResponse.json({
    ok:
      workflow?.ok === true &&
      restoreError === null,
    action: body.action,
    bookingId: booking.id,
    bookingRestored:
      restoreError === null,
    restoreError,
    workflow
  });
}
