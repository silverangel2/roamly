import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { sendCompanionNotificationDelivery } from "@/lib/roamly/companionNotifications";

const ALLOWED_STATUSES = new Set([
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "retrying",
  "suppressed",
  "deduplicated",
  "captured"
]);

const ALLOWED_TYPES = new Set([
  "booking_detected",
  "booking_confirmed",
  "flight_delay",
  "flight_cancelled",
  "booking_changed",
  "repair_proposed",
  "repair_applied",
  "approval_required",
  "daily_briefing",
  "final_day_briefing",
  "check_in_reminder",
  "trip_completed",
  "feedback_request"
]);

export async function GET(request: NextRequest) {
  const guard = await requireRoamlyAdmin();

  if (!guard.ok) {
    return guard.response;
  }

  const status = request.nextUrl.searchParams.get("status")?.trim() || "";
  const type = request.nextUrl.searchParams.get("type")?.trim() || "";
  const limitValue = Number(
    request.nextUrl.searchParams.get("limit") || "100"
  );

  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(limitValue, 250))
    : 100;

  let query = guard.admin
    .from("roamly_companion_notification_deliveries")
    .select(
      [
        "id",
        "user_id",
        "trip_id",
        "booking_id",
        "companion_event_id",
        "repair_proposal_id",
        "notification_id",
        "notification_type",
        "priority",
        "channel",
        "title",
        "body",
        "action_label",
        "action_url",
        "status",
        "attempt_count",
        "max_attempts",
        "provider_name",
        "provider_message_id",
        "last_error",
        "suppression_reason",
        "is_test",
        "metadata_json",
        "scheduled_for",
        "next_attempt_at",
        "sent_at",
        "delivered_at",
        "failed_at",
        "created_at",
        "updated_at"
      ].join(",")
    )
    .order("created_at", {
      ascending: false
    })
    .limit(limit);

  if (status && ALLOWED_STATUSES.has(status)) {
    query = query.eq("status", status);
  }

  if (type && ALLOWED_TYPES.has(type)) {
    query = query.eq("notification_type", type);
  }

  const result = await query;

  if (result.error) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error.message
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    deliveries: result.data || []
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();

  if (!guard.ok) {
    return guard.response;
  }

  let body: {
    action?: string;
    deliveryId?: string;
  };

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
    body.action !== "retry" ||
    !body.deliveryId
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unsupported Companion notification action."
      },
      { status: 400 }
    );
  }

  const existing = await guard.admin
    .from("roamly_companion_notification_deliveries")
    .select("id,status")
    .eq("id", body.deliveryId)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json(
      {
        ok: false,
        error: existing.error.message
      },
      { status: 500 }
    );
  }

  if (!existing.data) {
    return NextResponse.json(
      {
        ok: false,
        error: "Companion delivery was not found."
      },
      { status: 404 }
    );
  }

  if (
    !["failed", "retrying", "queued"].includes(
      existing.data.status
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Only failed, retrying, or queued deliveries can be retried."
      },
      { status: 409 }
    );
  }

  await guard.admin
    .from("roamly_companion_notification_deliveries")
    .update({
      status: "queued",
      next_attempt_at: new Date().toISOString(),
      failed_at: null,
      last_error: null
    })
    .eq("id", body.deliveryId);

  const result =
    await sendCompanionNotificationDelivery(
      body.deliveryId
    );

  return NextResponse.json(
    {
      ok: result.ok,
      result
    },
    {
      status: result.ok ? 200 : 502
    }
  );
}
