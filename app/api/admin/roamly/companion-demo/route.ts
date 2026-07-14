import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import {
  queueCompanionNotification,
  sendCompanionNotificationDelivery
} from "@/lib/roamly/companionNotifications";

type DemoAction =
  | "send_test_email"
  | "simulate_delay"
  | "simulate_cancellation"
  | "approval_required"
  | "daily_briefing";

type DemoRequestBody = {
  action?: DemoAction;
  tripId?: string | null;
};

function tripUrl(tripId?: string | null) {
  return tripId ? `/trip/${tripId}/live` : "/admin/companion-demo";
}

function getNotificationForAction(
  action: DemoAction,
  tripId?: string | null
) {
  switch (action) {
    case "simulate_delay":
      return {
        type: "flight_delay" as const,
        priority: "important" as const,
        title: "Your flight is delayed by 2 hours",
        body:
          "Roamly Companion detected a two-hour delay. Your itinerary may need timing adjustments.",
        actionLabel: "Review trip impact",
        actionUrl: tripUrl(tripId),
        metadata: {
          demoAction: action,
          delayMinutes: 120
        }
      };

    case "simulate_cancellation":
      return {
        type: "flight_cancelled" as const,
        priority: "critical" as const,
        title: "Your flight was cancelled",
        body:
          "Roamly Companion detected a cancellation. Review the trip to see affected activities and repair options.",
        actionLabel: "Open Companion",
        actionUrl: tripUrl(tripId),
        metadata: {
          demoAction: action,
          cancelled: true
        }
      };

    case "approval_required":
      return {
        type: "approval_required" as const,
        priority: "important" as const,
        title: "A trip repair needs your approval",
        body:
          "Roamly Companion prepared an itinerary repair that requires your approval before it can be applied.",
        actionLabel: "Review repair",
        actionUrl: tripUrl(tripId),
        metadata: {
          demoAction: action,
          approvalRequired: true
        }
      };

    case "daily_briefing":
      return {
        type: "daily_briefing" as const,
        priority: "routine" as const,
        title: "Your Roamly daily briefing",
        body:
          "Your itinerary is ready. Review today’s activities, bookings, timing, and any Companion updates.",
        actionLabel: "View today’s trip",
        actionUrl: tripUrl(tripId),
        metadata: {
          demoAction: action,
          briefingType: "daily"
        }
      };

    case "send_test_email":
    default:
      return {
        type: "booking_confirmed" as const,
        priority: "routine" as const,
        title: "Roamly Companion test email",
        body:
          "This is a controlled transactional email test from the real Roamly Companion notification pipeline.",
        actionLabel: "Open Companion Demo",
        actionUrl: "/admin/companion-demo",
        metadata: {
          demoAction: "send_test_email",
          controlledTest: true
        }
      };
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();

  if (!guard.ok) {
    return guard.response;
  }

  let body: DemoRequestBody;

  try {
    body = (await request.json()) as DemoRequestBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid JSON body."
      },
      { status: 400 }
    );
  }

  const action = body.action;

  if (
    !action ||
    ![
      "send_test_email",
      "simulate_delay",
      "simulate_cancellation",
      "approval_required",
      "daily_briefing"
    ].includes(action)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unsupported Companion demo action."
      },
      { status: 400 }
    );
  }

  const notification = getNotificationForAction(action, body.tripId);

  const queued = await queueCompanionNotification({
    supabase: guard.admin,
    userId: guard.user.id,
    tripId: body.tripId || null,
    type: notification.type,
    priority: notification.priority,
    title: notification.title,
    body: notification.body,
    actionLabel: notification.actionLabel,
    actionUrl: notification.actionUrl,
    isTest: true,
    metadata: notification.metadata,
    dedupeParts: [
      "admin_companion_demo",
      action,
      body.tripId || null,
      new Date().toISOString()
    ]
  });

  if (!queued.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: queued.error
      },
      { status: 500 }
    );
  }

  const deliveryId = queued.delivery.id as string;
  const delivery = await sendCompanionNotificationDelivery(deliveryId);

  return NextResponse.json(
    {
      ok: delivery.ok,
      action,
      queued: true,
      deduplicated: queued.deduplicated,
      deliveryId,
      delivery
    },
    {
      status: delivery.ok ? 200 : 502
    }
  );
}
