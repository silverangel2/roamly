import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanComment, PlanCommentSource } from "@/lib/roamly/concierge/planCommentReader";
import { PLAN_COMMENTS_TABLE } from "@/lib/roamly/planComments";

/**
 * PlanCommentSource adapter backed by the plan_comments table
 * (migration 20261016000200_plan_comments.sql).
 *
 * Implements the Concierge's contract EXACTLY: listComments({ tripId, userId })
 * returns PlanComment[] in oldest-first order. Fail-soft: any read failure
 * (including the migration not being applied yet) resolves to an empty list —
 * the Concierge's loadAndReadPlanComments also catches, so the reader stays
 * dormant rather than breaking generation.
 *
 * Ownership: callers pass a client scoped to the traveler's own session
 * (the trip page server context); the query additionally filters on both
 * trip_id and user_id, and RLS enforces user_id = auth.uid().
 *
 * Ship path: lib/roamly/concierge/planCommentSourceDb.ts (next to
 * planCommentReader.ts).
 */
export function createDbPlanCommentSource(supabase: SupabaseClient): PlanCommentSource {
  return {
    listComments: async ({ tripId, userId }: { tripId: string; userId?: string | null }): Promise<PlanComment[]> => {
      try {
        let query = supabase.from(PLAN_COMMENTS_TABLE).select("id,body,created_at,scope,ref").eq("trip_id", tripId);
        if (userId) query = query.eq("user_id", userId);
        const { data, error } = await query.order("created_at", { ascending: true }).limit(200);
        if (error || !Array.isArray(data)) return [];
        const comments: PlanComment[] = [];
        for (const row of data as Array<Record<string, unknown>>) {
          const text = typeof row.body === "string" ? row.body.trim() : "";
          if (!text) continue;
          const scope = row.scope === "day" || row.scope === "item" ? (row.scope as "day" | "item") : "itinerary";
          comments.push({
            id: String(row.id ?? ""),
            text,
            createdAt: row.created_at ? String(row.created_at) : null,
            scope,
            ref: row.ref ? String(row.ref) : null
          });
        }
        return comments;
      } catch {
        return [];
      }
    }
  };
}
