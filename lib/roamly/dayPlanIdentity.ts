// lib/roamly/dayPlanIdentity.ts — identical-day detection (correction
// phase, 2026-10-28, audit D3).
//
// A day plan is identified by its ordered stop-title sequence
// (normalized: trimmed, case-folded, whitespace-collapsed, empties
// dropped). Two days with the same sequence are IDENTICAL plans, even
// if their summaries differ — the traveler experiences the same day
// twice. This is defense-in-depth: the generator's activity-repeat
// rule (gate1b) already forbids any activity name repeating across
// days, which necessarily forbids identical days too, and the
// readiness validation flags repeats. This module names the identical
// case directly so a seed, fixture, or future generator path that
// repeats whole days is caught by name, not inferred from repeats.
//
// Pure function: no I/O, no mutation.

function normalizeTitle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

/** Day numbers (1-based) of every pair of days sharing an identical
 *  ordered stop-title sequence. Empty days (no titles) never match:
 *  an empty day is an open day, not a repeated plan. */
export function findIdenticalDayPlans(days: ReadonlyArray<ReadonlyArray<unknown>>): Array<{ days: [number, number] }> {
  const sequences = days.map((day) => day.map(normalizeTitle).filter(Boolean));
  const pairs: Array<{ days: [number, number] }> = [];
  for (let i = 0; i < sequences.length; i++) {
    if (!sequences[i].length) continue;
    for (let j = i + 1; j < sequences.length; j++) {
      if (sequences[i].length !== sequences[j].length) continue;
      if (sequences[i].every((title, index) => title === sequences[j][index])) {
        pairs.push({ days: [i + 1, j + 1] });
      }
    }
  }
  return pairs;
}
