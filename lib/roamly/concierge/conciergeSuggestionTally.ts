/**
 * conciergeRowsToSuggestionTally — producer-side adapter from the Concierge's
 * suggestion log to the Library Keeper's keep-rate contract.
 *
 * ARCHITECTURAL NOTE (one line): the shim lives in the CONCIERGE tree, not the
 * keeper's, because it is the Concierge's own trip-scoped id scheme and row
 * shape that must be translated — the keeper stays consumer-only (its
 * `LibrarySuggestionLogEntry` type in roamlyKeeper.ts is untouched and the
 * keeper never imports Concierge code). The tally shape below is a structural
 * match of `{ suggestionId, label, kept, dropped }`.
 *
 * STABLE IDENTITY KEY (documented): suggestion ids bake in the trip id
 * (`concierge:<trip>:<kind>:day<n>:<ref>`), so the same suggestion type on two
 * trips has two ids — the keeper cannot aggregate "this suggestion type"
 * across trips from raw ids (audit 1B). The stable key used here is:
 *   1. `pattern:<pattern_key>` when a pattern backs the suggestion — the
 *      pattern is the thing the keeper judges; else
 *   2. `suggestion:<kind>:<normalized title>` (lowercase, collapsed whitespace;
 *      falls back to item_ref, then "untitled").
 * Rows with no decided outcome yet are ignored until an outcome is recorded;
 * only groups with at least one kept/dropped outcome are emitted.
 *
 * KEEPER WIRING (exact one-call, in the keeper route where KeeperDeps is
 * assembled — future code, not shipped here):
 *   import { conciergeRowsToSuggestionTally } from "@/lib/roamly/concierge/conciergeSuggestionTally";
 *   const { data } = await db.from("concierge_suggestions")
 *     .select("id,trip_id,user_id,kind,day_number,item_ref,title,reason,pattern_key,pattern_trip_count,applied,outcome");
 *   const deps: KeeperDeps = {
 *     db, env, now,
 *     suggestions: conciergeRowsToSuggestionTally((data ?? []) as ConciergeSuggestionRow[]),
 *   };
 *
 * Ship path: lib/roamly/concierge/conciergeSuggestionTally.ts (this file).
 */

import type { ConciergeSuggestionRow } from "@/lib/roamly/concierge/conciergeSuggestions";

/** Structural match of the keeper's LibrarySuggestionLogEntry (roamlyKeeper.ts). */
export type KeeperSuggestionTally = {
  suggestionId: string;
  label: string;
  kept: number;
  dropped: number;
};

function normalizeTitle(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cross-trip identity for one suggestion row. pattern_key first (the judged
 * entity), else kind + normalized human label.
 */
export function stableSuggestionKey(row: ConciergeSuggestionRow): string {
  if (row.pattern_key && String(row.pattern_key).trim()) {
    return `pattern:${String(row.pattern_key).trim()}`;
  }
  const title = normalizeTitle(row.title);
  const fallback = title || normalizeTitle(row.item_ref) || "untitled";
  return `suggestion:${row.kind}:${fallback}`;
}

/**
 * Aggregate per-trip Concierge rows into keeper-shaped tallies. Deterministic:
 * same rows in → same tallies out (sorted by suggestionId).
 */
export function conciergeRowsToSuggestionTally(rows: ConciergeSuggestionRow[] | null | undefined): KeeperSuggestionTally[] {
  const groups = new Map<string, { label: string; kept: number; dropped: number }>();
  for (const row of rows ?? []) {
    if (!row || (row.outcome !== "kept" && row.outcome !== "dropped")) continue;
    const key = stableSuggestionKey(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        label: row.pattern_key ? String(row.pattern_key) : String(row.title ?? key),
        kept: 0,
        dropped: 0
      };
      groups.set(key, group);
    }
    if (row.outcome === "kept") group.kept += 1;
    else group.dropped += 1;
  }
  return [...groups.entries()]
    .map(([suggestionId, group]) => ({ suggestionId, ...group }))
    .sort((a, b) => (a.suggestionId < b.suggestionId ? -1 : a.suggestionId > b.suggestionId ? 1 : 0));
}
