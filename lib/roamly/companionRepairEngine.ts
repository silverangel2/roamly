import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canAutomaticallyApplyCompanionAction,
  getCompanionPreferences
} from "@/lib/roamly/companionPreferences";

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

  const safeActions = asArray(impactResult.data.safe_automatic_actions)
    .map((action) => normalizeAction(action, false))
    .filter((action): action is RepairAction => Boolean(action));

  const approvalActions = asArray(impactResult.data.approval_required_actions)
    .map((action) => normalizeAction(action, true))
    .filter((action): action is RepairAction => Boolean(action));

  const allActions = [...safeActions, ...approvalActions];
  const affectedLayers = Array.isArray(eventResult.data.affected_layers)
    ? eventResult.data.affected_layers.filter(
        (layer: unknown): layer is string => typeof layer === "string"
      )
    : [];

  const requiresApproval =
    Boolean(eventResult.data.requires_user_approval) ||
    Boolean(impactResult.data.traveler_action_required) ||
    approvalActions.length > 0;

  const proposalInsert = await params.supabase
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
    const actionsInsert = await params.supabase
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
        await params.supabase
          .from("companion_repair_proposals")
          .update({
            status: "applied",
            applied_at: new Date().toISOString()
          })
          .eq("id", proposalInsert.data.id)
          .eq("user_id", params.userId);

        await params.supabase
          .from("companion_events")
          .update({ status: "applied" })
          .eq("id", params.companionEventId)
          .eq("user_id", params.userId);
      }
    } catch (error) {
      await params.supabase
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
    await params.supabase
      .from("companion_events")
      .update({ status: "proposed" })
      .eq("id", params.companionEventId)
      .eq("user_id", params.userId);
  }

  const finalProposal = await params.supabase
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

  await params.supabase
    .from("companion_repair_proposals")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString()
    })
    .eq("id", params.repairProposalId)
    .eq("user_id", params.userId);

  await params.supabase
    .from("companion_actions")
    .update({ action_status: "approved" })
    .eq("repair_proposal_id", params.repairProposalId)
    .eq("user_id", params.userId)
    .in("action_status", ["pending", "awaiting_approval"]);

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

    await params.supabase
      .from("companion_repair_proposals")
      .update({
        status: applied ? "applied" : "partially_applied",
        applied_at: new Date().toISOString()
      })
      .eq("id", params.repairProposalId)
      .eq("user_id", params.userId);

    await params.supabase
      .from("companion_events")
      .update({ status: applied ? "applied" : "resolved" })
      .eq("id", proposalResult.data.companion_event_id)
      .eq("user_id", params.userId);
  } catch (error) {
    await params.supabase
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
