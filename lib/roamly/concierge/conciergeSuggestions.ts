/**
 * Concierge suggestion log + keep-rate measurement.
 *
 * Every suggestion the Concierge emits is logged with a stable id so Junel
 * can see which suggestions travelers actually keep. A suggestion nobody
 * keeps is visible as such in this log data (outcome stays NULL until a
 * keep/drop is recorded — NULL is itself the signal).
 *
 * Storage: `concierge_suggestions` (see
 * supabase/migrations/20261016_concierge_suggestions.sql — Junel applies it;
 * the store degrades to { ok:false, disabled:true } when the table is absent,
 * and the Concierge never depends on the log).
 *
 * Outcome seam: call `markSuggestionOutcome` from anywhere, and/or
 * `recordConciergeOutcomesFromFeedback` right after submitTripFeedback's
 * upsert (fail-soft, zero behavior change on failure — see the wiring note).
 *
 * Ship path: lib/roamly/concierge/conciergeSuggestions.ts (this file).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConciergeSuggestion, ConciergeSuggestionKind } from "@/lib/roamly/concierge/travelerConcierge";
import type { CommentSignal } from "@/lib/roamly/concierge/planCommentReader";

/* ── Structural Postgrest typing (repo has no generated Database types) ─ */

type PostgrestResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

type PostgrestQuery = PromiseLike<PostgrestResult> & {
  eq: (column: string, value: unknown) => PostgrestQuery;
  is: (column: string, value: unknown) => PostgrestQuery;
  order: (column: string, options: { ascending: boolean }) => PostgrestQuery;
  limit: (count: number) => PostgrestQuery;
  select: (columns: string) => PromiseLike<PostgrestResult>;
  update: (values: Record<string, unknown>) => PostgrestUpdateQuery;
};

type PostgrestUpdateQuery = PromiseLike<PostgrestResult> & {
  eq: (column: string, value: unknown) => PostgrestUpdateQuery;
};

type InsertResult = {
  data: unknown;
  error: { message: string } | null;
};

type SupabaseLike = {
  from: (table: string) => {
    insert: (rows: Record<string, unknown>[]) => PromiseLike<InsertResult>;
    select: (columns: string) => PostgrestQuery;
    update: (values: Record<string, unknown>) => PostgrestUpdateQuery;
  };
};

function asSupabaseLike(client: SupabaseClient): SupabaseLike {
  return client as unknown as SupabaseLike;
}

function tableMissingFrom(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null | undefined)?.message || error || "");
  return /does not exist|relation .* not found|42P01/i.test(message);
}

/* ── Row shape ──────────────────────────────────────────────────── */

export type ConciergeSuggestionOutcome = "kept" | "dropped";

export type ConciergeSuggestionRow = {
  id: string;
  trip_id: string | null;
  user_id: string | null;
  kind: ConciergeSuggestionKind;
  day_number: number | null;
  item_ref: string | null;
  title: string;
  reason: string;
  pattern_key: string | null;
  pattern_trip_count: number | null;
  applied: boolean;
  outcome: ConciergeSuggestionOutcome | null;
  created_at?: string;
  updated_at?: string;
};

export type SuggestionLogResult =
  | { ok: true; logged: number }
  | { ok: false; disabled: boolean; error: string };

/**
 * Log every suggestion the Concierge emitted. Fail-soft: storage absent or
 * any error → { ok:false }, never a throw. Idempotent per suggestion id.
 */
export async function logConciergeSuggestions(params: {
  supabase: SupabaseClient;
  tripId?: string | null;
  userId?: string | null;
  suggestions: ConciergeSuggestion[];
}): Promise<SuggestionLogResult> {
  try {
    const { suggestions } = params;
    if (!suggestions.length) return { ok: true, logged: 0 };
    const rows: Record<string, unknown>[] = suggestions.map((suggestion) => ({
      id: suggestion.id,
      trip_id: params.tripId ?? null,
      user_id: params.userId ?? null,
      kind: suggestion.kind,
      day_number: suggestion.dayNumber ?? null,
      item_ref: suggestion.itemRef ?? null,
      title: suggestion.title,
      reason: suggestion.reason,
      pattern_key: suggestion.patternKey ?? null,
      pattern_trip_count: suggestion.patternBacking,
      applied: suggestion.applied,
      outcome: null
    }));
    const { error } = await asSupabaseLike(params.supabase).from("concierge_suggestions").insert(rows);
    if (error) {
      return { ok: false, disabled: tableMissingFrom(error), error: error.message };
    }
    return { ok: true, logged: rows.length };
  } catch (error) {
    return { ok: false, disabled: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fire-and-forget suggestion logging for the customize flow (audit 1C).
 * Never throws, never produces an unhandled rejection — logging is advisory
 * and must never change the itinerary the Concierge returns. A null/undefined
 * client or an empty suggestion list means "logging disabled", skipped.
 */
export function logSuggestionsFireAndForget(params: {
  supabase: SupabaseClient | null | undefined;
  tripId?: string | null;
  userId?: string | null;
  suggestions: ConciergeSuggestion[];
}): void {
  if (!params.supabase || !params.suggestions.length) return;
  try {
    const settled = logConciergeSuggestions({
      supabase: params.supabase,
      tripId: params.tripId ?? null,
      userId: params.userId ?? null,
      suggestions: params.suggestions
    });
    // logConciergeSuggestions never throws by construction, but a hostile
    // client must not leak an unhandled rejection either.
    void Promise.resolve(settled).catch(() => {});
  } catch {
    // advisory only — the itinerary was already computed
  }
}

/**
 * Record a keep/drop outcome for one suggestion. Fail-soft, never throws.
 */
export async function markSuggestionOutcome(params: {
  supabase: SupabaseClient;
  suggestionId: string;
  outcome: ConciergeSuggestionOutcome;
}): Promise<SuggestionLogResult> {
  try {
    const { error } = await asSupabaseLike(params.supabase)
      .from("concierge_suggestions")
      .update({ outcome: params.outcome, updated_at: new Date().toISOString() })
      .eq("id", params.suggestionId);
    if (error) {
      return { ok: false, disabled: tableMissingFrom(error), error: error.message };
    }
    return { ok: true, logged: 1 };
  } catch (error) {
    return { ok: false, disabled: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function matchesItem(row: ConciergeSuggestionRow, haystacks: string[]): boolean {
  const rowText = `${row.title || ""} ${row.item_ref || ""}`.toLowerCase();
  return haystacks.some((text) => text.length >= 4 && rowText.includes(text));
}

/**
 * A negative comment about a specific pick counts as evidence against that
 * pick for THIS traveler immediately (personalization): the matching logged
 * suggestion is marked "dropped". Aggregate learning from comments happens
 * only through the existing trip_feedback path (see the wiring note on
 * recordConciergeOutcomesFromFeedback) — comments never write patterns
 * directly.
 *
 * Fail-soft: returns { ok:false } on any storage problem, never throws.
 */
export async function applyCommentOutcomesToSuggestions(params: {
  supabase: SupabaseClient;
  tripId: string;
  signals: CommentSignal[];
}): Promise<{ ok: boolean; marked: number; error?: string }> {
  try {
    const negative = params.signals
      .filter((signal) => signal.polarity === "want_less")
      .map((signal) => signal.detail.replace(/_/g, " "));
    const positive = params.signals
      .filter((signal) => signal.polarity === "want_more" && signal.dimension === "interests")
      .map((signal) => signal.detail.replace(/_/g, " "));
    if (!negative.length && !positive.length) return { ok: true, marked: 0 };
    const result = await asSupabaseLike(params.supabase)
      .from("concierge_suggestions")
      .select("*")
      .eq("trip_id", params.tripId)
      .is("outcome", null)
      .order("created_at", { ascending: true })
      .limit(200);
    if (result.error) {
      return { ok: false, marked: 0, error: result.error.message };
    }
    const rows = (Array.isArray(result.data) ? result.data : []) as ConciergeSuggestionRow[];
    let marked = 0;
    for (const row of rows) {
      let outcome: ConciergeSuggestionOutcome | null = null;
      if (matchesItem(row, negative)) outcome = "dropped";
      else if (matchesItem(row, positive)) outcome = "kept";
      if (!outcome) continue;
      const mark = await markSuggestionOutcome({ supabase: params.supabase, suggestionId: row.id, outcome });
      if (mark.ok) marked += 1;
    }
    return { ok: true, marked };
  } catch (error) {
    return { ok: false, marked: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Map a traveler's post_trip / in_trip feedback onto the Concierge's logged
 * suggestions for the same trip:
 *   - item named in skipped_activities or disappointing_activities → dropped
 *   - item named in favourite_activities → kept
 *   - otherwise → left NULL (no signal — which is itself the keep-rate
 *     signal for suggestions nobody reacts to)
 *
 * Fail-soft: returns { ok:false } on any storage problem, never throws.
 *
 * WIRING NOTE (seam in lib/roamly/tripFeedback.ts :: submitTripFeedback,
 * right after the feedback upsert + preference-event write, before the
 * return): add
 *
 *   try {
 *     await recordConciergeOutcomesFromFeedback({
 *       supabase: params.supabase,
 *       tripId: params.tripId,
 *       userId: params.userId,
 *       feedback: params.input
 *     });
 *   } catch { // keep-rate is measurement, never the feedback path }
 *
 * No signature changes, no new columns on trip_feedback, no behavior change
 * when concierge_suggestions is absent (the store reports disabled).
 */
export async function recordConciergeOutcomesFromFeedback(params: {
  supabase: SupabaseClient;
  tripId: string;
  userId: string;
  feedback: {
    favouriteActivities?: unknown;
    disappointingActivities?: unknown;
    skippedActivities?: unknown;
  };
}): Promise<{ ok: boolean; marked: number; error?: string }> {
  try {
    const favourites = cleanStringList(params.feedback.favouriteActivities);
    const disappointments = cleanStringList(params.feedback.disappointingActivities);
    const skipped = cleanStringList(params.feedback.skippedActivities);
    if (!favourites.length && !disappointments.length && !skipped.length) {
      return { ok: true, marked: 0 };
    }
    const result = await asSupabaseLike(params.supabase)
      .from("concierge_suggestions")
      .select("*")
      .eq("trip_id", params.tripId)
      .is("outcome", null)
      .order("created_at", { ascending: true })
      .limit(200);
    if (result.error) {
      return { ok: false, marked: 0, error: result.error.message };
    }
    const rows = (Array.isArray(result.data) ? result.data : []) as ConciergeSuggestionRow[];
    let marked = 0;
    for (const row of rows) {
      let outcome: ConciergeSuggestionOutcome | null = null;
      if (matchesItem(row, skipped) || matchesItem(row, disappointments)) outcome = "dropped";
      else if (matchesItem(row, favourites)) outcome = "kept";
      if (!outcome) continue;
      const mark = await markSuggestionOutcome({ supabase: params.supabase, suggestionId: row.id, outcome });
      if (mark.ok) marked += 1;
    }
    return { ok: true, marked };
  } catch (error) {
    return { ok: false, marked: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
