import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Roamly plan comments — traveler notes on their own trip/itinerary.
 *
 * Owner-only by construction: every read/write path first proves the trip
 * belongs to the caller (`roamly_trips.id + user_id`, mirroring tripFeedback).
 * A trip that is not the caller's yields TRIP_NOT_FOUND — never a leak.
 *
 * Fail-soft: until migration 20261016000200_plan_comments.sql is applied,
 * every entrypoint resolves to an unavailable outcome instead of throwing
 * into the itinerary page.
 */

export const PLAN_COMMENT_BODY_MAX = 2000;
export const PLAN_COMMENTS_TABLE = "plan_comments";

export type PlanCommentScope = "itinerary" | "day" | "item";

export type PlanCommentRecord = {
  id: string;
  trip_id: string;
  user_id: string;
  body: string;
  scope: PlanCommentScope;
  ref: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanCommentErrorCode =
  | "TRIP_NOT_FOUND"
  | "EMPTY_BODY"
  | "BODY_TOO_LONG"
  | "TABLE_UNAVAILABLE";

function cleanBody(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateCommentBody(value: unknown):
  | { ok: true; body: string }
  | { ok: false; error: "EMPTY_BODY" | "BODY_TOO_LONG" } {
  const body = cleanBody(value);
  if (!body) return { ok: false, error: "EMPTY_BODY" };
  if (body.length > PLAN_COMMENT_BODY_MAX) return { ok: false, error: "BODY_TOO_LONG" };
  return { ok: true, body };
}

/** True when the failure means the table is not there yet (migration unapplied). */
export function isTableMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /relation .* does not exist|42P01/i.test(message);
}

function normalizeCommentRow(row: Record<string, unknown>): PlanCommentRecord {
  const scope = row.scope === "day" || row.scope === "item" ? (row.scope as PlanCommentScope) : "itinerary";
  return {
    id: String(row.id || ""),
    trip_id: String(row.trip_id || ""),
    user_id: String(row.user_id || ""),
    body: String(row.body || ""),
    scope,
    ref: row.ref ? String(row.ref) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

async function ownsTrip(params: { supabase: SupabaseClient; userId: string; tripId: string }): Promise<boolean> {
  try {
    const trip = await params.supabase
      .from("roamly_trips")
      .select("id")
      .eq("id", params.tripId)
      .eq("user_id", params.userId)
      .maybeSingle();
    if (trip.error) return false;
    return Boolean(trip.data);
  } catch {
    return false;
  }
}

export async function listPlanComments(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}): Promise<{ comments: PlanCommentRecord[]; error: string | null }> {
  try {
    const owned = await ownsTrip(params);
    if (!owned) return { comments: [], error: "TRIP_NOT_FOUND" };
    const result = await params.supabase
      .from(PLAN_COMMENTS_TABLE)
      .select("*")
      .eq("trip_id", params.tripId)
      .eq("user_id", params.userId)
      .order("created_at", { ascending: true });
    if (result.error) {
      if (isTableMissing(result.error)) return { comments: [], error: "TABLE_UNAVAILABLE" };
      return { comments: [], error: result.error.message };
    }
    return {
      comments: (result.data || []).map((row) => normalizeCommentRow(row as Record<string, unknown>)),
      error: null
    };
  } catch (error) {
    return { comments: [], error: error instanceof Error ? error.message : "UNKNOWN_ERROR" };
  }
}

export async function addPlanComment(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  body: unknown;
  scope?: unknown;
  ref?: unknown;
}): Promise<{ ok: true; comment: PlanCommentRecord } | { ok: false; error: string }> {
  const validation = validateCommentBody(params.body);
  if (!validation.ok) return { ok: false, error: validation.error };

  try {
    const owned = await ownsTrip(params);
    if (!owned) return { ok: false, error: "TRIP_NOT_FOUND" };

    const scope: PlanCommentScope =
      params.scope === "day" || params.scope === "item" ? params.scope : "itinerary";

    const insert = await params.supabase
      .from(PLAN_COMMENTS_TABLE)
      .insert({
        trip_id: params.tripId,
        user_id: params.userId,
        body: validation.body,
        scope,
        ref: typeof params.ref === "string" && params.ref.trim() ? params.ref.trim().slice(0, 120) : null
      })
      .select("*")
      .single();
    if (insert.error) {
      if (isTableMissing(insert.error)) return { ok: false, error: "TABLE_UNAVAILABLE" };
      return { ok: false, error: insert.error.message };
    }
    return { ok: true, comment: normalizeCommentRow(insert.data as Record<string, unknown>) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" };
  }
}
