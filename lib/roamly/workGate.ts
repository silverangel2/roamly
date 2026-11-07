/**
 * EGRESS DIET (2026-11-02) — work gates for recurring lanes.
 *
 * Design law: no schedule polls blindly. Before a recurring lane runs
 * its heavy scan it answers "is there real work in my window?" with
 * ONE cheap indexed existence check per work source: a head/count
 * query over minimal columns (PostgREST returns no row bodies for
 * head requests, so the check costs a few hundred bytes, not the
 * table). If every source is empty the lane exits immediately.
 *
 * Fail-open law: a gate is an optimisation, never a correctness
 * dependency. If a count query errors (schema drift, transient
 * failure) the lane proceeds with its normal scan — a gate that can
 * skip real work is a defect, so doubt always resolves to "work".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type FilteredQuery = {
  eq: (column: string, value: unknown) => FilteredQuery;
  in: (column: string, values: unknown[]) => FilteredQuery;
  or: (filters: string) => FilteredQuery;
  not: (column: string, operator: string, value: unknown) => FilteredQuery;
  is: (column: string, value: unknown) => FilteredQuery;
  lte: (column: string, value: unknown) => FilteredQuery;
  gte: (column: string, value: unknown) => FilteredQuery;
  lt: (column: string, value: unknown) => FilteredQuery;
  gt: (column: string, value: unknown) => FilteredQuery;
  then: PromiseLike<{ count: number | null; error: { message: string } | null }>["then"];
};

/**
 * Count rows in `table` matching the filters applied by `apply`.
 * Returns null when the count could not be determined (caller must
 * fail open). The query selects only "id" with head:true, so no row
 * bodies cross the wire.
 */
export async function countWorkRows(
  supabase: SupabaseClient,
  table: string,
  apply: (query: FilteredQuery) => FilteredQuery,
  countColumn = "id"
): Promise<number | null> {
  try {
    const base = supabase
      .from(table)
      .select(countColumn, { count: "exact", head: true }) as unknown as FilteredQuery;
    const result = await apply(base);
    if (result.error) return null;
    return typeof result.count === "number" ? result.count : null;
  } catch {
    return null;
  }
}

/**
 * True when at least one work source has rows. A null count (query
 * failed) counts as work — fail-open, per the law above.
 */
export function anyWorkPresent(counts: Array<number | null>): boolean {
  return counts.some((count) => count === null || count > 0);
}
