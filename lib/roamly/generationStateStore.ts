/**
 * GAP-CLOSURE WAVE 2, TASK 5a (2026-11-02) — the shared seam between
 * trip metadata and the new `roamly_trip_generation_states` table
 * (migration 20261102000100, part of the post-Nov-5 diet package,
 * NOT YET APPLIED).
 *
 * TRANSITION BOUNDARY (this round): the staged generation state
 * document is DUAL-WRITTEN — every writer funnel that persists the
 * state into `roamly_trips.metadata` (the metadata copy stays EXACTLY
 * as it is) also upserts the same state object here. Reads flip only
 * on the two paths named in the task: the KF-2 recovery sweep
 * (generationRecovery.ts) and the generation status route. The
 * worker/engine advance paths keep reading metadata this round —
 * dual-write keeps the metadata copy complete, so they lose nothing.
 *
 * DISAGREEMENT RULE: when a row exists in this table it is
 * authoritative — if the table state and the metadata state disagree,
 * the NEW TABLE wins. Readers fall back to metadata only when NO row
 * exists (a trip mid-generation at migration time has state only in
 * metadata until its next persist dual-writes it) or when the table
 * cannot be read at all.
 *
 * FAIL-SOFT LAW: nothing in this module may break generation. The
 * table does not exist until the owner applies the migration, and
 * generation today works without it — so the dual-write swallows
 * every error (logging a diagnostic) and every read returns null on
 * error, which callers already treat as "fall back to metadata".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logGenerationDiagnostic } from "@/lib/roamly/generationDiagnostics";
import type { StagedGenerationState } from "@/lib/roamly/stagedItineraryGeneration";

export const GENERATION_STATES_TABLE = "roamly_trip_generation_states";

const STATE_ROW_COLUMNS = "trip_id,user_id,state,status,updated_at";

export type GenerationStateRow = {
  trip_id: string;
  user_id: string;
  state: StagedGenerationState;
  status: string;
  updated_at: string;
};

/**
 * Dual-write one state persist into roamly_trip_generation_states.
 * Called by the three writer funnels with the SAME state object they
 * persist into trip metadata. Returns true when the row was written;
 * false (never throws) when the table is missing/unreachable — the
 * metadata write that precedes this call is the durable copy.
 */
export async function dualWriteGenerationState(
  supabase: SupabaseClient,
  params: { tripId: string; userId: string; state: StagedGenerationState }
): Promise<boolean> {
  try {
    const { error } = await supabase.from(GENERATION_STATES_TABLE).upsert(
      {
        trip_id: params.tripId,
        user_id: params.userId,
        state: params.state,
        status: params.state.status,
        updated_at: params.state.updatedAt || new Date().toISOString()
      },
      { onConflict: "trip_id" }
    );
    if (error) {
      logGenerationDiagnostic("generation_state_dual_write_failed", {
        route: "generationStateStore",
        tripId: params.tripId,
        errorCode: error.message
      });
      return false;
    }
    return true;
  } catch (error) {
    logGenerationDiagnostic("generation_state_dual_write_failed", {
      route: "generationStateStore",
      tripId: params.tripId,
      errorCode: error instanceof Error ? error.message : "GENERATION_STATE_DUAL_WRITE_FAILED"
    });
    return false;
  }
}

/** One trip's state row, or null when no row exists OR the read
 *  failed (missing table pre-migration included) — callers fall back
 *  to trip metadata on null, per the disagreement rule above. */
export async function readGenerationStateRow(
  supabase: SupabaseClient,
  tripId: string
): Promise<GenerationStateRow | null> {
  try {
    const { data, error } = await supabase
      .from(GENERATION_STATES_TABLE)
      .select(STATE_ROW_COLUMNS)
      .eq("trip_id", tripId)
      .maybeSingle();
    if (error || !data) return null;
    return data as GenerationStateRow;
  } catch {
    return null;
  }
}

/** Batch variant for scan-shaped callers: a Map keyed by trip_id with
 *  an entry ONLY for trips that have a row, so `map.has(tripId)`
 *  distinguishes "row exists" (table wins) from "no row" (metadata
 *  fallback). Any read failure yields an empty map = all-metadata. */
export async function readGenerationStateRows(
  supabase: SupabaseClient,
  tripIds: string[]
): Promise<Map<string, GenerationStateRow>> {
  const out = new Map<string, GenerationStateRow>();
  if (!tripIds.length) return out;
  try {
    const { data, error } = await supabase
      .from(GENERATION_STATES_TABLE)
      .select(STATE_ROW_COLUMNS)
      .in("trip_id", tripIds)
      .limit(tripIds.length);
    if (error || !Array.isArray(data)) return out;
    for (const row of data as GenerationStateRow[]) {
      if (row && typeof row.trip_id === "string") out.set(row.trip_id, row);
    }
    return out;
  } catch {
    return out;
  }
}
