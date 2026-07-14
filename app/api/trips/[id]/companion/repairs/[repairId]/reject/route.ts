import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { queueCompanionNotification } from "@/lib/roamly/companionNotifications";

type RouteContext = {
  params: Promise<{
    id: string;
    repairId: string;
  }>;
};

export async function POST(
  _request: Request,
  context: RouteContext
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id, repairId } = await context.params;

  const existing = await auth.supabase
    .from("companion_repair_proposals")
    .select(
      "id,status,companion_event_id,title,summary,repair_summary"
    )
    .eq("id", repairId)
    .eq("trip_id", id)
    .eq("user_id", auth.user.id)
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
        error: "REPAIR_PROPOSAL_NOT_FOUND"
      },
      { status: 404 }
    );
  }

  if (
    ["applied", "approved", "completed"].includes(
      existing.data.status
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "APPLIED_REPAIR_CANNOT_BE_REJECTED"
      },
      { status: 409 }
    );
  }

  if (existing.data.status === "rejected") {
    return NextResponse.json({
      ok: true,
      repair: existing.data,
      alreadyRejected: true
    });
  }

  const reviewedAt = new Date().toISOString();

  const result = await auth.supabase
    .from("companion_repair_proposals")
    .update({
      status: "rejected",
      reviewed_at: reviewedAt
    })
    .eq("id", repairId)
    .eq("trip_id", id)
    .eq("user_id", auth.user.id)
    .select("*")
    .single();

  if (result.error) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error.message
      },
      { status: 500 }
    );
  }

  await auth.supabase
    .from("companion_actions")
    .update({
      action_status: "rejected"
    })
    .eq("repair_proposal_id", repairId)
    .eq("user_id", auth.user.id)
    .in("action_status", [
      "pending",
      "awaiting_approval",
      "approved"
    ]);

  if (existing.data.companion_event_id) {
    await auth.supabase
      .from("companion_events")
      .update({
        status: "dismissed"
      })
      .eq(
        "id",
        existing.data.companion_event_id
      )
      .eq("user_id", auth.user.id);
  }

  const notification =
    await queueCompanionNotification({
      supabase: auth.supabase,
      userId: auth.user.id,
      tripId: id,
      companionEventId:
        existing.data.companion_event_id,
      repairProposalId: repairId,
      type: "booking_changed",
      priority: "routine",
      title: "Original trip plan kept",
      body:
        "Roamly recorded your choice to keep the original itinerary. The suggested repair will not be applied.",
      actionLabel: "Open trip",
      actionUrl: `/trip/${id}/live`,
      metadata: {
        repairProposalId: repairId,
        source: "traveler_repair_rejection",
        rejectedAt: reviewedAt
      },
      dedupeParts: [
        "repair_rejection_confirmation",
        repairId
      ]
    });

  return NextResponse.json({
    ok: true,
    repair: result.data,
    notification
  });
}
