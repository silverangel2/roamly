import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeCompanionImpact } from "@/lib/roamly/companionImpactAnalysis";
import { createCompanionRepairProposal } from "@/lib/roamly/companionRepairEngine";
import { queueCompanionNotification } from "@/lib/roamly/companionNotifications";

export type CompanionBookingChangeType =
  | "flight_delayed"
  | "flight_cancelled"
  | "flight_time_changed"
  | "hotel_changed"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_updated";

export type CompanionSeverity =
  | "minor"
  | "routine"
  | "important"
  | "critical";

type ProcessCompanionBookingChangeParams = {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  bookingId: string;
  eventType: CompanionBookingChangeType;
  severity: CompanionSeverity;
  title: string;
  summary: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  source: string;
  effectiveAt?: string | null;
  affectedLayers?: string[];
  requiresUserApproval?: boolean;
  fingerprintParts?: unknown[];
};

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function notificationForEvent(params: {
  eventType: CompanionBookingChangeType;
  severity: CompanionSeverity;
  title: string;
  summary: string;
  tripId: string;
  repairProposalId?: string | null;
}) {
  const actionUrl = `/trip/${params.tripId}/live`;

  if (params.eventType === "flight_cancelled") {
    return {
      type: "flight_cancelled" as const,
      priority: "critical" as const,
      title: params.title,
      body: params.summary,
      actionLabel: "Review trip repair",
      actionUrl
    };
  }

  if (
    params.eventType === "flight_delayed" ||
    params.eventType === "flight_time_changed"
  ) {
    return {
      type: "flight_delay" as const,
      priority:
        params.severity === "critical"
          ? ("critical" as const)
          : ("important" as const),
      title: params.title,
      body: params.summary,
      actionLabel: "Review trip impact",
      actionUrl
    };
  }

  if (params.repairProposalId) {
    return {
      type: "repair_proposed" as const,
      priority:
        params.severity === "critical"
          ? ("critical" as const)
          : ("important" as const),
      title: "Roamly prepared a trip repair",
      body:
        "Companion analyzed the booking change and prepared an itinerary repair for review.",
      actionLabel: "Review repair",
      actionUrl
    };
  }

  if (params.eventType === "booking_confirmed") {
    return {
      type: "booking_confirmed" as const,
      priority: "routine" as const,
      title: params.title,
      body: params.summary,
      actionLabel: "View booking",
      actionUrl
    };
  }

  return {
    type: "booking_changed" as const,
    priority: params.severity,
    title: params.title,
    body: params.summary,
    actionLabel: "Open Companion",
    actionUrl
  };
}

export async function processCompanionBookingChange(
  params: ProcessCompanionBookingChangeParams
) {
  const eventFingerprint = fingerprint([
    "companion_booking_change",
    params.userId,
    params.tripId,
    params.bookingId,
    params.eventType,
    params.oldValue || {},
    params.newValue || {},
    ...(params.fingerprintParts || [])
  ]);

  const bookingChangeResult = await params.supabase
    .from("booking_change_events")
    .upsert(
      {
        booking_id: params.bookingId,
        trip_id: params.tripId,
        user_id: params.userId,
        event_type: params.eventType,
        old_value_json: params.oldValue || {},
        new_value_json: params.newValue || {},
        source: params.source,
        effective_at: params.effectiveAt || null,
        severity: params.severity,
        event_fingerprint: eventFingerprint
      },
      {
        onConflict: "user_id,event_fingerprint",
        ignoreDuplicates: true
      }
    )
    .select("*")
    .maybeSingle();

  if (bookingChangeResult.error) {
    return {
      ok: false as const,
      stage: "booking_change_event" as const,
      error: bookingChangeResult.error.message
    };
  }

  const companionEventResult = await params.supabase
    .from("companion_events")
    .upsert(
      {
        trip_id: params.tripId,
        user_id: params.userId,
        source_booking_id: params.bookingId,
        event_type: params.eventType,
        severity: params.severity,
        status: "processing",
        title: params.title,
        summary: params.summary,
        affected_layers: params.affectedLayers || [],
        requires_user_approval:
          params.requiresUserApproval === true,
        event_fingerprint: eventFingerprint
      },
      {
        onConflict: "user_id,event_fingerprint"
      }
    )
    .select("*")
    .maybeSingle();

  if (companionEventResult.error) {
    return {
      ok: false as const,
      stage: "companion_event" as const,
      error: companionEventResult.error.message
    };
  }

  const companionEvent = companionEventResult.data;

  if (!companionEvent) {
    return {
      ok: false as const,
      stage: "companion_event" as const,
      error: "COMPANION_EVENT_NOT_CREATED"
    };
  }

  const impactResult = await analyzeCompanionImpact({
    supabase: params.supabase,
    companionEventId: companionEvent.id
  });

  if (!impactResult.ok) {
    await params.supabase
      .from("companion_events")
      .update({
        status: "new"
      })
      .eq("id", companionEvent.id)
      .eq("user_id", params.userId);

    return {
      ok: false as const,
      stage: "impact_analysis" as const,
      companionEvent,
      error: impactResult.error
    };
  }

  const repairResult = await createCompanionRepairProposal({
    supabase: params.supabase,
    userId: params.userId,
    tripId: params.tripId,
    companionEventId: companionEvent.id
  });

  const repairProposal =
    repairResult.ok && "proposal" in repairResult
      ? repairResult.proposal
      : null;

  const repairProposalId =
    repairProposal &&
    typeof repairProposal === "object" &&
    "id" in repairProposal &&
    typeof repairProposal.id === "string"
      ? repairProposal.id
      : null;

  await params.supabase
    .from("companion_events")
    .update({
      status: repairProposal ? "proposed" : "resolved",
      requires_user_approval:
        params.requiresUserApproval === true ||
        impactResult.impact.travelerActionRequired === true
    })
    .eq("id", companionEvent.id)
    .eq("user_id", params.userId);

  const notification = notificationForEvent({
    eventType: params.eventType,
    severity: params.severity,
    title: params.title,
    summary: params.summary,
    tripId: params.tripId,
    repairProposalId
  });

  const queuedNotification = await queueCompanionNotification({
    supabase: params.supabase,
    userId: params.userId,
    tripId: params.tripId,
    bookingId: params.bookingId,
    companionEventId: companionEvent.id,
    repairProposalId,
    type: notification.type,
    priority: notification.priority,
    title: notification.title,
    body: notification.body,
    actionLabel: notification.actionLabel,
    actionUrl: notification.actionUrl,
    metadata: {
      source: params.source,
      eventType: params.eventType,
      severity: params.severity,
      eventFingerprint
    },
    dedupeParts: [
      eventFingerprint,
      notification.type,
      repairProposalId
    ]
  });

  await params.supabase
    .from("booking_change_events")
    .update({
      processed_at: new Date().toISOString()
    })
    .eq("user_id", params.userId)
    .eq("event_fingerprint", eventFingerprint);

  return {
    ok: true as const,
    eventFingerprint,
    bookingChangeEvent: bookingChangeResult.data || null,
    companionEvent,
    impact: impactResult,
    repair: repairResult,
    notification: queuedNotification
  };
}
