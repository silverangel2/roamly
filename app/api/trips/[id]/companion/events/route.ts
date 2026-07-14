import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const ownership = await auth.supabase
    .from("roamly_trips")
    .select("id")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (ownership.error) {
    return NextResponse.json(
      {
        ok: false,
        error: ownership.error.message
      },
      { status: 500 }
    );
  }

  if (!ownership.data) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRIP_NOT_FOUND"
      },
      { status: 404 }
    );
  }

  const [eventsResult, repairsResult] =
    await Promise.all([
      auth.supabase
        .from("companion_events")
        .select(
          [
            "id",
            "source_booking_id",
            "event_type",
            "severity",
            "status",
            "title",
            "summary",
            "affected_layers",
            "requires_user_approval",
            "detected_at",
            "resolved_at",
            "created_at",
            "updated_at"
          ].join(",")
        )
        .eq("trip_id", id)
        .eq("user_id", auth.user.id)
        .order("detected_at", {
          ascending: false
        })
        .limit(50),

      auth.supabase
        .from("companion_repair_proposals")
        .select(
          "id,companion_event_id,status,created_at,updated_at"
        )
        .eq("trip_id", id)
        .eq("user_id", auth.user.id)
        .order("created_at", {
          ascending: false
        })
    ]);

  if (eventsResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: eventsResult.error.message
      },
      { status: 500 }
    );
  }

  type EventRow = {
    id: string;
    source_booking_id: string | null;
    event_type: string;
    severity: string;
    status: string;
    title: string;
    summary: string;
    affected_layers: string[] | null;
    requires_user_approval: boolean;
    detected_at: string;
    resolved_at: string | null;
    created_at: string;
    updated_at: string | null;
  };

  type RepairRow = {
    id: string;
    companion_event_id: string | null;
    status: string | null;
    created_at: string;
    updated_at: string | null;
  };

  const eventRows =
    (eventsResult.data || []) as unknown as EventRow[];

  const repairRows =
    (repairsResult.data || []) as unknown as RepairRow[];

  const repairByEvent = new Map<
    string,
    {
      id: string;
      status: string | null;
    }
  >();

  for (const repair of repairRows) {
    if (
      repair.companion_event_id &&
      !repairByEvent.has(
        repair.companion_event_id
      )
    ) {
      repairByEvent.set(
        repair.companion_event_id,
        {
          id: repair.id,
          status: repair.status
        }
      );
    }
  }

  const events = eventRows.map(
    (event) => {
      const repair = repairByEvent.get(
        event.id
      );

      return {
        id: event.id,
        eventType: event.event_type,
        severity: event.severity,
        status: event.status,
        title: event.title,
        summary: event.summary,
        affectedLayers:
          event.affected_layers || [],
        requiresApproval:
          event.requires_user_approval,
        detectedAt: event.detected_at,
        resolvedAt: event.resolved_at,
        updatedAt: event.updated_at,
        repairId: repair?.id || null,
        repairStatus:
          repair?.status || null
      };
    }
  );

  return NextResponse.json({
    ok: true,
    events
  });
}
