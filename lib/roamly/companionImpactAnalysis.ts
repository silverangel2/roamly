import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const COMPANION_IMPACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fallback_options", "notes"],
  properties: {
    fallback_options: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } }
  }
} as const;

type CompanionEventRecord = {
  id: string;
  trip_id: string;
  user_id: string;
  source_booking_id: string | null;
  event_type: string;
  severity: "minor" | "routine" | "important" | "critical";
  title: string;
  summary: string;
  affected_layers: string[];
  requires_user_approval: boolean;
};

type ImpactResult = {
  severity: "minor" | "routine" | "important" | "critical";
  affectedItems: Array<Record<string, unknown>>;
  timingImpact: Record<string, unknown>;
  costImpact: Record<string, unknown>;
  travelerActionRequired: boolean;
  safeAutomaticActions: Array<Record<string, unknown>>;
  approvalRequiredActions: Array<Record<string, unknown>>;
  fallbackOptions: string[];
  analysis: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function itineraryItems(fullJson: unknown) {
  const itinerary = record(fullJson);
  return array(itinerary.daily_itinerary)
    .flatMap((day, index) => {
      const dayRecord = record(day);
      return array(dayRecord.live_timeline || dayRecord.timeline || dayRecord.activities).map((item) => ({
        day: dayRecord.day_number || index + 1,
        date: dayRecord.date || null,
        ...record(item)
      }));
    })
    .slice(0, 12);
}

function deterministicImpact(event: CompanionEventRecord, itinerary: unknown): ImpactResult {
  const items = itineraryItems(itinerary);
  const base = {
    severity: event.severity,
    affectedItems: items
      .filter((item) => {
        const itemRecord = record(item);
        return event.event_type.includes("flight")
          ? /airport|flight|arrival|dinner|transfer/i.test(String(itemRecord.title || itemRecord.description || ""))
          : true;
      })
      .slice(0, 6),
    costImpact: { amount_delta_known: false, paid_commitment_allowed: false },
    travelerActionRequired: event.requires_user_approval,
    fallbackOptions: [] as string[],
    analysis: {
      event_type: event.event_type,
      affected_layers: event.affected_layers,
      paid_commitments_blocked: true
    }
  };

  if (event.event_type === "flight_delayed") {
    return {
      ...base,
      timingImpact: { arrival_shift: "likely", downstream_plan_risk: true },
      safeAutomaticActions: [
        { action: "update_flight_timing", paid: false },
        { action: "recalculate_airport_transfer", paid: false },
        { action: "move_free_flexible_activity", paid: false }
      ],
      approvalRequiredActions: [{ action: "change_paid_reservation", paid: true }],
      fallbackOptions: ["Move dinner near the hotel", "Shift a flexible activity to tomorrow"]
    };
  }
  if (event.event_type === "flight_cancelled") {
    return {
      ...base,
      travelerActionRequired: true,
      timingImpact: { arrival_unknown: true, downstream_plan_risk: true, connection_risk: true },
      safeAutomaticActions: [{ action: "pause_dependent_reminders", paid: false }],
      approvalRequiredActions: [
        { action: "book_replacement_flight", paid: true },
        { action: "change_hotel_arrival", paid: false }
      ],
      fallbackOptions: ["Hold the first evening plan", "Prepare hotel late-arrival message"]
    };
  }
  if (["gate_changed", "terminal_changed"].includes(event.event_type)) {
    return {
      ...base,
      timingImpact: { airport_navigation_changed: true },
      safeAutomaticActions: [{ action: "update_airport_instructions", paid: false }],
      approvalRequiredActions: [],
      fallbackOptions: ["Show updated airport details"]
    };
  }
  if (["hotel_modified", "hotel_cancelled", "late_hotel_arrival", "check_in_conflict"].includes(event.event_type)) {
    return {
      ...base,
      travelerActionRequired: event.event_type === "hotel_cancelled" || event.requires_user_approval,
      timingImpact: { check_in_window_risk: true, evening_plan_risk: true },
      safeAutomaticActions: [{ action: "adjust_hotel_arrival_timing", paid: false }],
      approvalRequiredActions: [{ action: "book_replacement_hotel", paid: true }],
      fallbackOptions: ["Move evening plan near the hotel", "Add late-arrival warning"]
    };
  }
  return {
    ...base,
    timingImpact: { schedule_risk: true },
    safeAutomaticActions: [{ action: "revalidate_schedule", paid: false }],
    approvalRequiredActions: [{ action: "change_paid_activity", paid: true }],
    fallbackOptions: ["Use backup plan", "Replace optional activity"]
  };
}

async function aiImpactReview(event: CompanionEventRecord, impact: ImpactResult) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_COMPANION_IMPACT_MODEL || "gpt-4o-mini",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "roamly_companion_impact_review",
        schema: COMPANION_IMPACT_SCHEMA,
        strict: true
      }
    },
    messages: [
      {
        role: "system",
        content:
          "Review a travel disruption impact result. Suggest only non-purchase fallback options and concise notes. Do not book, cancel, purchase, or promise live availability."
      },
      { role: "user", content: JSON.stringify({ event, impact }) }
    ]
  });
  return JSON.parse(completion.choices[0]?.message?.content || "{}") as { fallback_options?: string[]; notes?: string[] };
}

export async function analyzeCompanionImpact(params: {
  supabase: SupabaseClient;
  companionEventId: string;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const { data: event, error } = await writer.from("companion_events").select("*").eq("id", params.companionEventId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!event) return { ok: false as const, error: "COMPANION_EVENT_NOT_FOUND" };
  const companionEvent = event as CompanionEventRecord;
  const { data: itinerary } = await writer
    .from("roamly_itineraries")
    .select("full_json")
    .eq("trip_id", companionEvent.trip_id)
    .eq("user_id", companionEvent.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const impact = deterministicImpact(companionEvent, record(itinerary).full_json);
  const aiReview = await aiImpactReview(companionEvent, impact).catch(() => null);
  if (aiReview?.fallback_options?.length) {
    impact.fallbackOptions = [...new Set([...impact.fallbackOptions, ...aiReview.fallback_options])].slice(0, 5);
    impact.analysis.ai_review_notes = aiReview.notes || [];
  }

  const saved = await writer.from("companion_impact_results").upsert(
    {
      companion_event_id: companionEvent.id,
      trip_id: companionEvent.trip_id,
      user_id: companionEvent.user_id,
      severity: impact.severity,
      affected_items_json: impact.affectedItems,
      timing_impact_json: impact.timingImpact,
      cost_impact_json: impact.costImpact,
      traveler_action_required: impact.travelerActionRequired,
      safe_automatic_actions: impact.safeAutomaticActions,
      approval_required_actions: impact.approvalRequiredActions,
      fallback_options: impact.fallbackOptions,
      analysis_json: impact.analysis
    },
    { onConflict: "companion_event_id" }
  ).select("*").maybeSingle();

  if (saved.error) return { ok: false as const, error: saved.error.message };
  return { ok: true as const, impact, row: saved.data };
}
