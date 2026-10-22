import type { BudgetPosture } from "@/lib/roamly/engine/predict";

/*
 * budgetVerdictDisplay — the traveler-facing form of the all-in
 * budget verdict (ship defect #2, 2026-10-22).
 *
 * The all-in verdict (WITHIN / AT RISK / OVER / UNVERIFIABLE, priced
 * over plan + lodging + getting-there by the shared scope in
 * budgetScope.ts) was computed at PREDICT and written ONLY into the
 * immutable prediction row — a service-role-only table the traveler
 * can never see. The itinerary page kept showing the legacy
 * composer breakdown, so the verdict the owner commissioned was
 * invisible to the person it was for.
 *
 * This module is the pure formatter: BudgetPosture -> a small,
 * self-describing display payload. Finalization stamps the payload
 * onto the saved itinerary document (`budget_verdict_display`), and
 * the trip page renders it for engine trips in place of the legacy
 * budget summary. Incumbent (non-engine) itineraries never carry
 * the field and keep the legacy display untouched.
 *
 * Laws carried over from the scope, verbatim in spirit:
 *   - an unevidenced component is NAMED and excluded — never
 *     counted, never shown as $0;
 *   - the 0–0 totals of a no-evidence posture are never presented
 *     as a price (totalLabel stays null);
 *   - every number shown comes from the posture — nothing is
 *     recomputed or invented at display time.
 */

export interface BudgetVerdictComponentLine {
  /** "Lodging" | "Getting there". */
  label: string;
  /** Priced: "Hôtel X · 4 nights — CAD 440–720 (estimated from its
   *  recorded price level)". Not priced: "not counted — no price
   *  evidence yet; it is not in the total and never counted as $0". */
  detail: string;
  evidenced: boolean;
}

export interface BudgetVerdictDisplay {
  version: 1;
  verdict: BudgetPosture["verdict"];
  /** Plain traveler language for the verdict word. */
  headline: string;
  /** The judge's own reason, verbatim. */
  reason: string;
  /** "Your budget: CAD 2,400" — null when no cap was recorded. */
  capLabel: string | null;
  /** "Estimated whole-trip total: CAD 1,348–2,724" — null when
   *  nothing in the all-in scope carries evidence. */
  totalLabel: string | null;
  /** "Priced from evidence for 19 of 20 parts of the whole trip —
   *  the plan, your stay, and getting there." */
  coverageLabel: string;
  componentLines: BudgetVerdictComponentLine[];
  /** The scope's own note (names excluded components), verbatim. */
  scopeNote: string;
}

const HEADLINES: Record<BudgetPosture["verdict"], string> = {
  WITHIN: "Within your budget",
  "AT RISK": "At risk of going over your budget",
  OVER: "Over your budget",
  UNVERIFIABLE: "We couldn't fully check this trip against your budget"
};

const COMPONENT_LABELS: Record<string, string> = {
  lodging: "Lodging",
  transport: "Getting there"
};

const TIER_LABELS: Record<string, string> = {
  VERIFIED: "recorded price",
  BAND: "estimated from a recorded price level",
  COSTED: "estimated from travel costs",
  UNKNOWN: "no price evidence"
};

/** Deterministic thousands grouping (no Intl — the same string on
 *  every runtime). Amounts are whole units in this engine. */
export function formatMoneyAmount(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function money(amount: number, currency: string): string {
  return `${currency} ${formatMoneyAmount(amount)}`;
}

function moneyRange(low: number, high: number, currency: string): string {
  return low === high ? money(low, currency) : `${currency} ${formatMoneyAmount(low)}–${formatMoneyAmount(high)}`;
}

export function buildBudgetVerdictDisplay(posture: BudgetPosture): BudgetVerdictDisplay {
  const totals = posture.estimatedTotals;
  const hasTotals = posture.evidencedScopeLines > 0 && Boolean(totals) && (totals.low > 0 || totals.high > 0);

  const componentLines: BudgetVerdictComponentLine[] = [];
  for (const line of posture.components) {
    if (!line.applicable) continue; // day-trip lodging leaves the scope entirely
    const label = COMPONENT_LABELS[line.component] || line.component;
    if (line.evidenced && line.evidence.range) {
      const range = line.evidence.range;
      const tier = TIER_LABELS[line.evidence.tier] || line.evidence.tier;
      const nights = line.nights ? ` · ${line.nights} night${line.nights === 1 ? "" : "s"}` : "";
      componentLines.push({
        label,
        detail: `${line.name}${nights} — ${moneyRange(range.low, range.high, range.currency)} (${tier})`,
        evidenced: true
      });
    } else {
      componentLines.push({
        label,
        detail: `${line.name} — not counted: no price evidence yet. It is not in the total, and it is never counted as $0.`,
        evidenced: false
      });
    }
  }

  return {
    version: 1,
    verdict: posture.verdict,
    headline: HEADLINES[posture.verdict],
    reason: posture.note,
    capLabel: posture.cap ? `Your budget: ${money(posture.cap.amount, posture.cap.currency)}` : null,
    totalLabel: hasTotals ? `Estimated whole-trip total: ${moneyRange(totals.low, totals.high, totals.currency)}` : null,
    coverageLabel:
      posture.scopeLines > 0
        ? `Priced from evidence for ${posture.evidencedScopeLines} of ${posture.scopeLines} parts of the whole trip — the plan, your stay, and getting there.`
        : "No priced evidence was available for this trip yet.",
    componentLines,
    scopeNote: posture.scopeNote
  };
}

/** Stamp the display payload onto an itinerary document about to
 *  be persisted. The document type (lib/itinerary.ts) does not
 *  declare the field — it rides the JSON document as an additive
 *  key, exactly like other engine-stamped fields, and the page's
 *  readBudgetVerdictDisplay guard is the only consumer contract. */
export function stampBudgetVerdictDisplay<T extends object>(doc: T, posture: BudgetPosture): T {
  return { ...doc, budget_verdict_display: buildBudgetVerdictDisplay(posture) } as T;
}

/** Read-side guard: the itinerary document is JSON from storage;
 *  only a payload this module's shape-check accepts may render.
 *  Anything else (incumbent docs, older docs, tampered docs)
 *  yields null and the page falls back to the legacy display. */
export function readBudgetVerdictDisplay(doc: unknown): BudgetVerdictDisplay | null {
  if (!doc || typeof doc !== "object") return null;
  const raw = (doc as Record<string, unknown>).budget_verdict_display;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const verdicts = ["WITHIN", "AT RISK", "OVER", "UNVERIFIABLE"];
  if (d.version !== 1 || typeof d.verdict !== "string" || !verdicts.includes(d.verdict)) return null;
  if (typeof d.headline !== "string" || typeof d.reason !== "string" || typeof d.coverageLabel !== "string" || typeof d.scopeNote !== "string") return null;
  if (d.capLabel !== null && typeof d.capLabel !== "string") return null;
  if (d.totalLabel !== null && typeof d.totalLabel !== "string") return null;
  if (!Array.isArray(d.componentLines)) return null;
  for (const line of d.componentLines) {
    if (!line || typeof line !== "object") return null;
    const l = line as Record<string, unknown>;
    if (typeof l.label !== "string" || typeof l.detail !== "string" || typeof l.evidenced !== "boolean") return null;
  }
  return raw as BudgetVerdictDisplay;
}
