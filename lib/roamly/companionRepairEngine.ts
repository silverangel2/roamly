import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canAutomaticallyApplyCompanionAction,
  getCompanionPreferences
} from "@/lib/roamly/companionPreferences";
import { getTripBundle } from "@/lib/trips";
import { payloadFromTrip } from "@/lib/roamly/marketPriceRefresh";
import { validateItineraryDeterministically } from "@/lib/roamly/itineraryValidation";
import { deriveTripReadiness } from "@/lib/roamly/tripReadiness";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type JsonRecord = Record<string, unknown>;

type RepairAction = {
  actionType: string;
  before: JsonRecord;
  after: JsonRecord;
  requiresApproval: boolean;
};

type RepairResult =
  | {
      ok: true;
      proposal: JsonRecord;
      actions: JsonRecord[];
      appliedAutomatically: boolean;
    }
  | {
      ok: false;
      error: string;
    };

type VerifiedRepairContext = {
  itineraryId: string;
  targetDayId: string;
  conflictId: string;
  targetItemId: string;
  expectedRevision: number;
  expectedContentHash: string;
  expectedEventFingerprint: string;
  expectedSourceBookingUpdatedAt: string;
  target: JsonRecord;
};

export type VerifiedCompanionRepairVerification = "RESOLVED" | "STILL_AFFECTED" | "UNCERTAIN";

export function classifyVerifiedCompanionRepair(params: {
  targetPresent: boolean;
  originalConflictPresent: boolean;
  canonicalValidationOk: boolean;
  canonicalRoutingKnown: boolean;
  sourceBookingCurrent: boolean;
}): VerifiedCompanionRepairVerification {
  if (params.targetPresent || params.originalConflictPresent) return "STILL_AFFECTED";
  if (!params.canonicalValidationOk || !params.canonicalRoutingKnown || !params.sourceBookingCurrent) return "UNCERTAIN";
  return "RESOLVED";
}

function stableKey(parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function exactOptionalActivity(value: unknown): value is JsonRecord {
  const item = asRecord(value);
  return (
    typeof item.day_id === "string" &&
    typeof item.item_id === "string" &&
    typeof item.conflict_id === "string" &&
    item.routing_status === "INFEASIBLE" &&
    item.item_type === "activity" &&
    item.must_do === false &&
    (item.plan_role === "supporting" || item.plan_role === "alternative") &&
    !("booking" in item) &&
    !("anchor_id" in item) &&
    item.hard_required !== true &&
    item.is_hard_requirement !== true
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function verifiedRepairContext(params: {
  supabase: SupabaseClient;
  event: JsonRecord;
  impact: JsonRecord;
  tripId: string;
  userId: string;
}): Promise<{ ok: true; context: VerifiedRepairContext } | { ok: false; error: string }> {
  if (!["flight_delayed", "flight_time_changed"].includes(String(params.event.event_type))) {
    return { ok: false, error: "COMPANION_REPAIR_EVENT_NOT_SUPPORTED" };
  }

  const itineraryResult = await params.supabase
    .from("roamly_itineraries")
    .select("id,full_json,repair_revision")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (itineraryResult.error || !itineraryResult.data) {
    return { ok: false, error: itineraryResult.error?.message || "ITINERARY_NOT_REPAIRABLE" };
  }

  const itinerary = asRecord(itineraryResult.data.full_json);
  const days = asArray(itinerary.daily_itinerary).map(asRecord);
  const affected = asArray(params.impact.affected_items_json).map(asRecord).filter(exactOptionalActivity);
  const candidates = affected.filter((item) =>
    days.some((day) =>
      day.day_id === item.day_id &&
      day.plan_status === "conflict" &&
      asArray(day.live_timeline).filter((candidate) => asRecord(candidate).item_id === item.item_id).length === 1
    )
  );
  if (candidates.length !== 1) {
    return { ok: false, error: candidates.length ? "COMPANION_REPAIR_TARGET_AMBIGUOUS" : "COMPANION_REPAIR_TARGET_NOT_PROVEN" };
  }

  const candidate = candidates[0];
  const targetDay = days.find((day) => day.day_id === candidate.day_id);
  if (!targetDay || targetDay.conflict_id !== candidate.conflict_id) {
    return { ok: false, error: "COMPANION_REPAIR_TARGET_NOT_PROVEN" };
  }
  const targetMatches = days.flatMap((day) => asArray(day.live_timeline).map(asRecord).filter((item) => item.item_id === candidate.item_id));
  if (targetMatches.length !== 1) {
    return { ok: false, error: "COMPANION_REPAIR_TARGET_NOT_PROVEN" };
  }
  const target = targetMatches[0];

  if (
    !isUuid(String(itineraryResult.data.id)) ||
    !isUuid(String(target.day_id)) ||
    !isUuid(String(target.conflict_id)) ||
    !isUuid(String(target.item_id)) ||
    !String(params.event.event_fingerprint || "").trim() ||
    !String(impactResultId(params.impact) || "").trim()
  ) {
    return { ok: false, error: "COMPANION_REPAIR_EVIDENCE_INCOMPLETE" };
  }

  const revision = Number(itineraryResult.data.repair_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return { ok: false, error: "ITINERARY_NOT_REPAIRABLE" };
  }
  const hash = await params.supabase.rpc("roamly_itinerary_content_hash", { value: itineraryResult.data.full_json });
  if (hash.error || typeof hash.data !== "string" || !hash.data.trim()) {
    return { ok: false, error: hash.error?.message || "ITINERARY_HASH_UNAVAILABLE" };
  }

  const bookingId = typeof params.event.source_booking_id === "string" ? params.event.source_booking_id : "";
  const booking = await params.supabase
    .from("roamly_bookings")
    .select("updated_at")
    .eq("id", bookingId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .eq("booking_type", "flight")
    .in("booking_status", ["booked", "paid", "reserved"])
    .maybeSingle();
  if (booking.error || !booking.data?.updated_at) {
    return { ok: false, error: booking.error?.message || "COMPANION_REPAIR_SOURCE_BOOKING_NOT_CONFIRMED" };
  }

  return {
    ok: true,
    context: {
      itineraryId: String(itineraryResult.data.id),
      targetDayId: String(target.day_id),
      conflictId: String(target.conflict_id),
      targetItemId: String(target.item_id),
      expectedRevision: revision,
      expectedContentHash: hash.data,
      expectedEventFingerprint: String(params.event.event_fingerprint || ""),
      expectedSourceBookingUpdatedAt: String(booking.data.updated_at),
      target
    }
  };
}

function impactResultId(impact: JsonRecord) {
  return typeof impact.id === "string" ? impact.id : null;
}

function normalizeAction(value: unknown, requiresApproval: boolean): RepairAction | null {
  const source = asRecord(value);

  const actionType =
    typeof source.action_type === "string"
      ? source.action_type
      : typeof source.type === "string"
        ? source.type
        : typeof source.action === "string"
          ? source.action
          : null;

  if (!actionType) return null;

  return {
    actionType,
    before: asRecord(source.before),
    after: asRecord(source.after ?? source.changes ?? source.payload),
    requiresApproval
  };
}

function proposalSummary(params: {
  eventTitle?: unknown;
  safeCount: number;
  approvalCount: number;
}): string {
  const title =
    typeof params.eventTitle === "string" && params.eventTitle.trim()
      ? params.eventTitle.trim()
      : "Travel change";

  if (params.approvalCount > 0) {
    return `${title}. Roamly prepared an update that needs your approval.`;
  }

  if (params.safeCount > 0) {
    return `${title}. Roamly prepared safe itinerary adjustments.`;
  }

  return `${title}. No automatic itinerary change is required.`;
}

async function findCurrentGenerationJob(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<{ id: string } | null> {
  const result = await supabase
    .from("roamly_trip_generation_jobs")
    .select("id")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error || !result.data) return null;
  return result.data as { id: string };
}

async function invalidateAffectedLayers(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
  affectedLayers: string[];
}): Promise<void> {
  if (!params.affectedLayers.length) return;

  const job = await findCurrentGenerationJob(
    params.supabase,
    params.tripId,
    params.userId
  );

  if (!job) return;

  await params.supabase
    .from("roamly_trip_generation_layers")
    .update({
      status: "invalidated",
      error_code: null,
      error_message: null,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null
    })
    .eq("job_id", job.id)
    .eq("user_id", params.userId)
    .in("layer_type", params.affectedLayers);

  await params.supabase
    .from("roamly_trip_generation_jobs")
    .update({
      status: "queued",
      current_stage: params.affectedLayers[0],
      next_attempt_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error_code: null,
      last_error_message: null
    })
    .eq("id", job.id)
    .eq("user_id", params.userId);
}

async function applySafeActions(params: {
  supabase: SupabaseClient;
  proposalId: string;
  tripId: string;
  userId: string;
  affectedLayers: string[];
}): Promise<boolean> {
  const actionsResult = await params.supabase
    .from("companion_actions")
    .select("*")
    .eq("repair_proposal_id", params.proposalId)
    .eq("user_id", params.userId)
    .eq("requires_approval", false)
    .in("action_status", ["pending", "approved"]);

  if (actionsResult.error) {
    throw new Error(actionsResult.error.message);
  }

  const actions = actionsResult.data || [];
  if (!actions.length) return false;

  for (const action of actions) {
    await params.supabase
      .from("companion_actions")
      .update({ action_status: "applying" })
      .eq("id", action.id)
      .eq("user_id", params.userId);

    /*
     * Safe actions are represented as structured itinerary changes.
     * We do not purchase, cancel or modify external reservations here.
     * The affected Brain layers are invalidated and regenerated using the
     * saved action payload as audit evidence.
     */
    await params.supabase
      .from("companion_actions")
      .update({
        action_status: "completed",
        completed_at: new Date().toISOString()
      })
      .eq("id", action.id)
      .eq("user_id", params.userId);
  }

  await invalidateAffectedLayers({
    supabase: params.supabase,
    tripId: params.tripId,
    userId: params.userId,
    affectedLayers: params.affectedLayers
  });

  return true;
}

export async function createCompanionRepairProposal(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  companionEventId: string;
}): Promise<RepairResult> {
  const writer = createSupabaseAdminClient() || params.supabase;
  const eventResult = await params.supabase
    .from("companion_events")
    .select("*")
    .eq("id", params.companionEventId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (eventResult.error) return { ok: false, error: eventResult.error.message };
  if (!eventResult.data) return { ok: false, error: "COMPANION_EVENT_NOT_FOUND" };

  const impactResult = await params.supabase
    .from("companion_impact_results")
    .select("*")
    .eq("companion_event_id", params.companionEventId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (impactResult.error) return { ok: false, error: impactResult.error.message };
  if (!impactResult.data) return { ok: false, error: "IMPACT_ANALYSIS_NOT_FOUND" };

  const existing = await params.supabase
    .from("companion_repair_proposals")
    .select("*")
    .eq("companion_event_id", params.companionEventId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (existing.error) return { ok: false, error: existing.error.message };

  if (existing.data) {
    if (
      ["flight_delayed", "flight_time_changed"].includes(String(eventResult.data.event_type)) &&
      existing.data.operation !== "REMOVE_OPTIONAL_ACTIVITY"
    ) {
      return { ok: false, error: "COMPANION_REPAIR_EVIDENCE_INCOMPLETE" };
    }
    const actions = await params.supabase
      .from("companion_actions")
      .select("*")
      .eq("repair_proposal_id", existing.data.id)
      .eq("user_id", params.userId)
      .order("created_at", { ascending: true });

    return {
      ok: true,
      proposal: existing.data,
      actions: actions.data || [],
      appliedAutomatically: existing.data.status === "applied"
    };
  }

  const v1ContextResult = ["flight_delayed", "flight_time_changed"].includes(String(eventResult.data.event_type))
    ? await verifiedRepairContext({
        supabase: params.supabase,
        event: asRecord(eventResult.data),
        impact: asRecord(impactResult.data),
        tripId: params.tripId,
        userId: params.userId
      })
    : null;
  if (v1ContextResult && !v1ContextResult.ok) return { ok: false, error: v1ContextResult.error };
  const v1Context = v1ContextResult?.context || null;

  const safeActions = v1Context
    ? []
    : asArray(impactResult.data.safe_automatic_actions)
        .map((action) => normalizeAction(action, false))
        .filter((action): action is RepairAction => Boolean(action));

  const approvalActions = v1Context
    ? [{
        actionType: "REMOVE_OPTIONAL_ACTIVITY",
        before: v1Context.target,
        after: {
          operation: "REMOVE_OPTIONAL_ACTIVITY",
          day_id: v1Context.targetDayId,
          conflict_id: v1Context.conflictId,
          item_id: v1Context.targetItemId
        },
        requiresApproval: true
      }]
    : asArray(impactResult.data.approval_required_actions)
        .map((action) => normalizeAction(action, true))
        .filter((action): action is RepairAction => Boolean(action));

  const allActions = [...safeActions, ...approvalActions];
  const affectedLayers = Array.isArray(eventResult.data.affected_layers)
    ? eventResult.data.affected_layers.filter(
        (layer: unknown): layer is string => typeof layer === "string"
      )
    : [];

  const requiresApproval =
    Boolean(v1Context) ||
    Boolean(eventResult.data.requires_user_approval) ||
    Boolean(impactResult.data.traveler_action_required) ||
    approvalActions.length > 0;

  const proposalInsert = await writer
    .from("companion_repair_proposals")
    .insert({
      companion_event_id: params.companionEventId,
      impact_result_id: impactResult.data.id,
      trip_id: params.tripId,
      user_id: params.userId,
      summary: proposalSummary({
        eventTitle: eventResult.data.title,
        safeCount: safeActions.length,
        approvalCount: approvalActions.length
      }),
      affected_layers: affectedLayers,
      proposed_changes_json: allActions.map((action) => ({
        action_type: action.actionType,
        before: action.before,
        after: action.after,
        requires_approval: action.requiresApproval
      })),
      cost_change:
        typeof impactResult.data.cost_impact_json?.amount === "number"
          ? impactResult.data.cost_impact_json.amount
          : null,
      currency:
        typeof impactResult.data.cost_impact_json?.currency === "string"
          ? impactResult.data.cost_impact_json.currency
          : null,
      requires_approval: requiresApproval,
      ...(v1Context
        ? {
            itinerary_id: v1Context.itineraryId,
            operation: "REMOVE_OPTIONAL_ACTIVITY",
            target_day_id: v1Context.targetDayId,
            conflict_id: v1Context.conflictId,
            target_item_id: v1Context.targetItemId,
            expected_revision: v1Context.expectedRevision,
            expected_content_hash: v1Context.expectedContentHash,
            expected_event_fingerprint: v1Context.expectedEventFingerprint,
            expected_source_booking_updated_at: v1Context.expectedSourceBookingUpdatedAt,
            verification_status: "pending"
          }
        : {}),
      status: requiresApproval ? "awaiting_approval" : "proposed"
    })
    .select("*")
    .single();

  if (proposalInsert.error || !proposalInsert.data) {
    return {
      ok: false,
      error: proposalInsert.error?.message || "REPAIR_PROPOSAL_CREATE_FAILED"
    };
  }

  const actionRows = allActions.map((action, index) => ({
    repair_proposal_id: proposalInsert.data.id,
    trip_id: params.tripId,
    user_id: params.userId,
    action_type: action.actionType,
    action_status: action.requiresApproval ? "awaiting_approval" : "pending",
    before_json: action.before,
    after_json: action.after,
    requires_approval: action.requiresApproval,
    idempotency_key: stableKey([
      proposalInsert.data.id,
      index,
      action.actionType,
      action.before,
      action.after
    ])
  }));

  let savedActions: JsonRecord[] = [];

  if (actionRows.length) {
    const actionsInsert = await writer
      .from("companion_actions")
      .insert(actionRows)
      .select("*");

    if (actionsInsert.error) {
      return { ok: false, error: actionsInsert.error.message };
    }

    savedActions = actionsInsert.data || [];
  }

  let appliedAutomatically = false;

  const companionPreferences = await getCompanionPreferences({
    supabase: params.supabase,
    userId: params.userId,
    tripId: params.tripId
  });

  const costChange =
    typeof impactResult.data.cost_impact_json?.amount === "number"
      ? impactResult.data.cost_impact_json.amount
      : 0;

  const everySafeActionMayAutoApply =
    safeActions.length > 0 &&
    safeActions.every((action) =>
      canAutomaticallyApplyCompanionAction({
        preferences: companionPreferences,
        actionType: action.actionType,
        requiresApproval: action.requiresApproval,
        costChange
      })
    );

  if (
    !requiresApproval &&
    everySafeActionMayAutoApply
  ) {
    try {
      appliedAutomatically = await applySafeActions({
        supabase: params.supabase,
        proposalId: proposalInsert.data.id,
        tripId: params.tripId,
        userId: params.userId,
        affectedLayers
      });

      if (appliedAutomatically) {
        await writer
          .from("companion_repair_proposals")
          .update({
            status: "applied",
            applied_at: new Date().toISOString()
          })
          .eq("id", proposalInsert.data.id)
          .eq("user_id", params.userId);

        await writer
          .from("companion_events")
          .update({ status: "applied" })
          .eq("id", params.companionEventId)
          .eq("user_id", params.userId);
      }
    } catch (error) {
      await writer
        .from("companion_repair_proposals")
        .update({ status: "failed" })
        .eq("id", proposalInsert.data.id)
        .eq("user_id", params.userId);

      return {
        ok: false,
        error: error instanceof Error ? error.message : "SAFE_REPAIR_APPLY_FAILED"
      };
    }
  } else {
    await writer
      .from("companion_events")
      .update({ status: "proposed" })
      .eq("id", params.companionEventId)
      .eq("user_id", params.userId);
  }

  const finalProposal = await writer
    .from("companion_repair_proposals")
    .select("*")
    .eq("id", proposalInsert.data.id)
    .eq("user_id", params.userId)
    .single();

  return {
    ok: true,
    proposal: finalProposal.data || proposalInsert.data,
    actions: savedActions,
    appliedAutomatically
  };
}

export async function approveCompanionRepairProposal(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  repairProposalId: string;
}): Promise<RepairResult> {
  const writer = createSupabaseAdminClient() || params.supabase;
  const proposalResult = await params.supabase
    .from("companion_repair_proposals")
    .select("*")
    .eq("id", params.repairProposalId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (proposalResult.error) return { ok: false, error: proposalResult.error.message };
  if (!proposalResult.data) return { ok: false, error: "REPAIR_PROPOSAL_NOT_FOUND" };

  if (proposalResult.data.status === "applied") {
    if (
      proposalResult.data.operation === "REMOVE_OPTIONAL_ACTIVITY" &&
      proposalResult.data.verification_status === "pending"
    ) {
      return verifyAppliedVerifiedCompanionRepair({
        supabase: params.supabase,
        userId: params.userId,
        tripId: params.tripId,
        repairProposalId: params.repairProposalId
      });
    }
    const actions = await params.supabase
      .from("companion_actions")
      .select("*")
      .eq("repair_proposal_id", params.repairProposalId)
      .eq("user_id", params.userId);

    return {
      ok: true,
      proposal: proposalResult.data,
      actions: actions.data || [],
      appliedAutomatically: false
    };
  }

  const actionsResult = await params.supabase
    .from("companion_actions")
    .select("*")
    .eq("repair_proposal_id", params.repairProposalId)
    .eq("user_id", params.userId);

  if (actionsResult.error) return { ok: false, error: actionsResult.error.message };

  /*
   * Approval authorizes itinerary changes only.
   * External purchases, cancellations and paid reservation changes remain
   * prohibited and must be handled through a separate explicit booking flow.
   */
  const prohibited = (actionsResult.data || []).some((action) =>
    /purchase|book|cancel|refund|payment/i.test(String(action.action_type))
  );

  if (prohibited) {
    return { ok: false, error: "EXTERNAL_PAID_ACTION_NOT_ALLOWED" };
  }

  const actionApprovalUpdate = await writer
    .from("companion_actions")
    .update({ action_status: "approved" })
    .eq("repair_proposal_id", params.repairProposalId)
    .eq("user_id", params.userId)
    .in("action_status", ["pending", "awaiting_approval"]);
  if (actionApprovalUpdate.error) return { ok: false, error: actionApprovalUpdate.error.message };

  const approvalUpdate = await writer
    .from("companion_repair_proposals")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString()
    })
    .eq("id", params.repairProposalId)
    .eq("user_id", params.userId);
  if (approvalUpdate.error) return { ok: false, error: approvalUpdate.error.message };

  if (proposalResult.data.operation === "REMOVE_OPTIONAL_ACTIVITY") {
    const applied = await params.supabase.rpc("roamly_apply_verified_companion_repair", {
      p_proposal_id: params.repairProposalId,
      p_trip_id: params.tripId
    });
    if (applied.error) {
      return { ok: false, error: applied.error.message };
    }

    const verification = await verifyAppliedVerifiedCompanionRepair({
      supabase: params.supabase,
      userId: params.userId,
      tripId: params.tripId,
      repairProposalId: params.repairProposalId
    });
    if (!verification.ok) return verification;

    const updatedProposal = await params.supabase
      .from("companion_repair_proposals")
      .select("*")
      .eq("id", params.repairProposalId)
      .eq("user_id", params.userId)
      .single();
    const updatedActions = await params.supabase
      .from("companion_actions")
      .select("*")
      .eq("repair_proposal_id", params.repairProposalId)
      .eq("user_id", params.userId)
      .order("created_at", { ascending: true });

    return {
      ok: true,
      proposal: updatedProposal.data || proposalResult.data,
      actions: updatedActions.data || actionsResult.data || [],
      appliedAutomatically: false
    };
  }

  try {
    const applied = await applySafeActions({
      supabase: params.supabase,
      proposalId: params.repairProposalId,
      tripId: params.tripId,
      userId: params.userId,
      affectedLayers: Array.isArray(proposalResult.data.affected_layers)
        ? proposalResult.data.affected_layers
        : []
    });

    await writer
      .from("companion_repair_proposals")
      .update({
        status: applied ? "applied" : "partially_applied",
        applied_at: new Date().toISOString()
      })
      .eq("id", params.repairProposalId)
      .eq("user_id", params.userId);

    await writer
      .from("companion_events")
      .update({ status: applied ? "applied" : "resolved" })
      .eq("id", proposalResult.data.companion_event_id)
      .eq("user_id", params.userId);
  } catch (error) {
    await writer
      .from("companion_repair_proposals")
      .update({ status: "failed" })
      .eq("id", params.repairProposalId)
      .eq("user_id", params.userId);

    return {
      ok: false,
      error: error instanceof Error ? error.message : "REPAIR_APPLY_FAILED"
    };
  }

  const updatedProposal = await params.supabase
    .from("companion_repair_proposals")
    .select("*")
    .eq("id", params.repairProposalId)
    .eq("user_id", params.userId)
    .single();

  const updatedActions = await params.supabase
    .from("companion_actions")
    .select("*")
    .eq("repair_proposal_id", params.repairProposalId)
    .eq("user_id", params.userId)
    .order("created_at", { ascending: true });

  return {
    ok: true,
    proposal: updatedProposal.data || proposalResult.data,
    actions: updatedActions.data || [],
    appliedAutomatically: false
  };
}

export async function verifyAppliedVerifiedCompanionRepair(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  repairProposalId: string;
}): Promise<RepairResult> {
  const proposalResult = await params.supabase
    .from("companion_repair_proposals")
    .select("*")
    .eq("id", params.repairProposalId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (proposalResult.error) return { ok: false, error: proposalResult.error.message };
  if (!proposalResult.data) return { ok: false, error: "REPAIR_PROPOSAL_NOT_FOUND" };
  const proposal = asRecord(proposalResult.data);
  if (proposal.operation !== "REMOVE_OPTIONAL_ACTIVITY" || proposal.status !== "applied") {
    return { ok: false, error: "COMPANION_REPAIR_NOT_APPLIED" };
  }

  const existingTerminal = ["resolved", "still_affected", "uncertain"].includes(String(proposal.verification_status));
  if (existingTerminal && proposal.verified_at) {
    return { ok: true, proposal: proposalResult.data, actions: [], appliedAutomatically: false };
  }

  const bundle = await getTripBundle(params.supabase, params.userId, params.tripId);
  const itinerary = bundle.data?.itinerary?.full_json;
  if (!bundle.data || !itinerary) return { ok: false, error: "CANONICAL_ITINERARY_RELOAD_FAILED" };

  const days = asArray(asRecord(itinerary).daily_itinerary).map(asRecord);
  const targetPresent = days.some((day) =>
    asArray(day.live_timeline).some((value) => asRecord(value).item_id === proposal.target_item_id)
  );
  const originalConflictPresent = days.some((day) =>
    day.conflict_id === proposal.conflict_id && asArray(day.live_timeline).some((value) => {
      const item = asRecord(value);
      return item.conflict_id === proposal.conflict_id;
    })
  );

  const validation = validateItineraryDeterministically({
    itinerary,
    payload: payloadFromTrip(bundle.data.trip)
  });
  const canonicalRoutingKnown = days.every((day) =>
    asArray(day.live_timeline).every((value) => {
      const status = asRecord(value).routing_status;
      return status !== "UNKNOWN" && status !== "UNCERTAIN";
    })
  );
  const event = await params.supabase
    .from("companion_events")
    .select("source_booking_id")
    .eq("id", proposal.companion_event_id)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  const sourceBooking = event.data?.source_booking_id
    ? await params.supabase
        .from("roamly_bookings")
        .select("id,updated_at,booking_status")
        .eq("id", event.data.source_booking_id)
        .eq("trip_id", params.tripId)
        .eq("user_id", params.userId)
        .eq("booking_type", "flight")
        .in("booking_status", ["booked", "paid", "reserved"])
        .maybeSingle()
    : { data: null, error: null };
  const sourceBookingCurrent = Boolean(
    sourceBooking.data?.updated_at &&
      String(sourceBooking.data.updated_at) === String(proposal.expected_source_booking_updated_at)
  );
  const verificationStatus = classifyVerifiedCompanionRepair({
    targetPresent,
    originalConflictPresent,
    canonicalValidationOk: validation.ok,
    canonicalRoutingKnown,
    sourceBookingCurrent
  });
  const conflictCount = days.filter((day) => day.plan_status === "conflict").length;
  const uncertainItemCount = days.reduce((count, day) => count + (day.plan_status === "uncertain" || asArray(day.live_timeline).some((value) => ["UNKNOWN", "UNCERTAIN"].includes(String(asRecord(value).routing_status))) ? 1 : 0), 0);
  const readiness = deriveTripReadiness({
    tripId: params.tripId,
    startDate: bundle.data.trip.start_date,
    endDate: bundle.data.trip.end_date,
    generationStatus: bundle.data.trip.itinerary_status,
    hasItinerary: true,
    conflictCount: verificationStatus === "RESOLVED" ? Math.max(0, conflictCount - 1) : conflictCount,
    uncertainItemCount
  });

  const writer = createSupabaseAdminClient() || params.supabase;
  const verifiedAt = new Date().toISOString();
  const saved = await writer
    .from("companion_repair_proposals")
    .update({ verification_status: verificationStatus.toLowerCase(), verified_at: verifiedAt })
    .eq("id", params.repairProposalId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .eq("status", "applied")
    .eq("verification_status", "pending")
    .select("*")
    .maybeSingle();
  if (saved.error) return { ok: false, error: saved.error.message };

  await writer
    .from("companion_events")
    .update({ status: verificationStatus === "RESOLVED" ? "resolved" : "processing" })
    .eq("id", proposal.companion_event_id)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .in("status", ["proposed", "processing"]);

  return {
    ok: true,
    proposal: saved.data
      ? { ...saved.data, readiness_state: readiness.state }
      : { ...proposal, verification_status: verificationStatus.toLowerCase(), verified_at: verifiedAt, readiness_state: readiness.state },
    actions: [],
    appliedAutomatically: false
  };
}
