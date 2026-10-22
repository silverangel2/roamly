import { fmt } from "@/lib/roamly/engine/util";
import type { EngineDay, EngineItem, EnginePack } from "@/lib/roamly/engine/util";
import { judgeBudget } from "@/lib/roamly/engine/prices";
import type {
  BudgetJudgeItinerary,
  BudgetJudgeResult,
  LibraryPriceMap
} from "@/lib/roamly/engine/prices";
import type { BudgetCapDTO, TravelersDTO } from "@/lib/roamly/engine/types";
import type { BudgetScopeInputs } from "@/lib/roamly/engine/budgetScope";

/*
 * predict — PREDICT (Phase 2 port of the shadow zero-engine's
 * predict.mjs). The engine writes down what it expects, per plan,
 * BEFORE the trip happens: predicted highlights, predicted risks,
 * predicted budget posture. This record is what LEARN grades against
 * later; without it, "learning" is a slogan. Fit scoring is
 * deterministic arithmetic over facts the pack actually carries.
 *
 * One deliberate production change: the shadow stamps the record
 * with `new Date()` inline. The port takes the recording instant as
 * an injected input (`now`) so a generation job stamps it once and
 * tests reproduce it exactly; the default remains the current time.
 */

export interface FitScore {
  score: number;
  reasons: string[];
}

/** Fit score for a scheduled item: constraint survival + evidence quality. */
export function fitScore(item: EngineItem): FitScore {
  let score = 50;
  const reasons: string[] = [];
  if (item.role === "mustsee" || item.role === "excursion") {
    score += 25;
    reasons.push("named in the traveler's request");
  }
  if (item.hours?.status === "known") {
    score += 10;
    reasons.push(`hours verified (${item.hours.provenance || "data"})`);
  }
  if (item.type === "food" && item.diet?.strong) {
    score += 15;
    reasons.push("dietary fit proven by listing tags");
  }
  if (item.google?.rating) {
    score += Math.round((item.google.rating - 4) * 10);
    reasons.push(`rating ${item.google.rating} (${item.google.source})`);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export interface PredictionHighlight {
  name: string | undefined;
  day: number;
  score: number;
  reasons: string[];
}

export interface PredictionRisk {
  day: number;
  item: string | undefined;
  risk: string;
  severity: "low" | "medium";
}

export interface BudgetPosture {
  verdict: BudgetJudgeResult["verdict"];
  note: string;
  cap: BudgetCapDTO | null;
  coverage: number;
  coverageThreshold: number;
  pricedItems: number;
  evidencedItems: number;
  /** ALL-IN scope (2026-10-22): the scope lines the coverage is
   *  computed over (priced items + applicable lodging/getting-there
   *  lines) and the two component lines with their evidence. */
  scopeLines: number;
  evidencedScopeLines: number;
  components: BudgetJudgeResult["components"];
  evidenceByTier: Record<string, number>;
  estimatedTotals: BudgetJudgeResult["totals"];
  payingParty: number;
  scopeNote: string;
  priceBandsKnown: number;
  bandDistribution: Record<string, number>;
  bandSource: string | null;
}

export interface PaceLoadEntry {
  day: number;
  stops: number;
  walkingKmEstimated: number;
  lastEnd: string;
}

export interface PredictionRecord {
  recordedAt: string;
  engineStage: "PREDICT";
  highlights: PredictionHighlight[];
  risks: PredictionRisk[];
  budgetPosture: BudgetPosture;
  paceLoad: PaceLoadEntry[];
  learnContract: string;
}

export interface PredictItinerary extends BudgetJudgeItinerary {
  days: EngineDay[];
  travelers?: TravelersDTO;
  budgetCap?: { amount: number; currency: string } | null;
}

export interface BuildPredictionsOptions {
  libraryPrices?: LibraryPriceMap;
  /** The recording instant (ISO). Injected for reproducibility. */
  now?: string;
  /** ALL-IN scope inputs (lodging + getting-there evidence), passed
   *  through to the budget judge's shared scope (budgetScope.ts). */
  scope?: BudgetScopeInputs | null;
}

export function buildPredictions(
  itinerary: PredictItinerary,
  pack: EnginePack,
  opts: BuildPredictionsOptions = {}
): PredictionRecord {
  const libraryPrices = opts.libraryPrices ?? {};
  const items: (EngineItem & { day: number; date: string })[] = itinerary.days.flatMap((d) =>
    d.items.map((i) => ({ ...i, day: d.dayNumber, date: d.date }))
  );
  const stops = items.filter((i) => i.type !== "rest");

  const highlights: PredictionHighlight[] = stops
    .map((i) => ({ name: i.name, day: i.day, ...fitScore(i) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const risks: PredictionRisk[] = [];
  for (const i of stops) {
    if (i.hours?.status === "unknown")
      risks.push({
        day: i.day,
        item: i.name,
        risk: "opening hours not in any data source — door time could differ from the plan",
        severity: "medium"
      });
    if (i.hours?.status === "known" && i.hours.provenance === "google-fixture")
      risks.push({
        day: i.day,
        item: i.name,
        risk: "hours come from FIXTURE data (mechanism proof) — unverified against the live place",
        severity: "low"
      });
    if (i.type === "food" && !i.diet?.strong)
      risks.push({
        day: i.day,
        item: i.name,
        risk: "dietary fit not provable from listing tags — kitchen confirmation advised",
        severity: "medium"
      });
  }
  for (const day of itinerary.days) {
    for (const leg of day.legs) {
      if (leg.mode === "drive" && leg.km > 8)
        risks.push({
          day: day.dayNumber,
          item: leg.toName,
          risk: `long drive leg (${leg.km.toFixed(0)} km, ~${leg.minutes} min estimated from straight-line distance — real roads run longer)`,
          severity: "medium"
        });
    }
    const sorted = [...day.items].sort((a, b) => a.start - b.start);
    for (let k = 1; k < sorted.length; k++) {
      const gap = sorted[k].start - sorted[k - 1].end;
      if (sorted[k].type !== "rest" && sorted[k - 1].type !== "rest" && gap >= 0 && gap < 8) {
        risks.push({
          day: day.dayNumber,
          item: sorted[k].name,
          risk: `tight turnaround — only ${gap} min after "${sorted[k - 1].name}"`,
          severity: "low"
        });
      }
    }
    const w = (pack.weather || []).find((x) => x.date === day.date);
    const hasExcursion = day.items.some((i) => i.role === "excursion");
    if (hasExcursion && w?.precipProb != null && w.precipProb >= 50) {
      risks.push({
        day: day.dayNumber,
        item: "excursion day weather",
        risk: `forecast rain chance ${w.precipProb}% on the excursion day despite driest-day placement`,
        severity: "medium"
      });
    }
  }

  const banded = stops.filter((i) => i.priceBand);
  const bands: Record<string, number> = {};
  for (const i of banded) {
    const level = i.priceBand?.level;
    if (level) bands[level] = (bands[level] || 0) + 1;
  }
  // The budget posture is the price layer's verdict now (WS-PRICES,
  // 2026-10-21): WITHIN / AT RISK / OVER when labeled evidence (bands,
  // cost models, verified prices) covers a stated majority of the
  // plan's priced items; UNVERIFIABLE with the coverage stated
  // otherwise. The cap is still never faked as met — a verdict rides
  // on evidence.
  const budget = judgeBudget(itinerary, { libraryPrices, scope: opts.scope ?? null });
  const budgetPosture: BudgetPosture = {
    verdict: budget.verdict,
    note: budget.verdictReason,
    cap: (itinerary.budgetCap as BudgetCapDTO | null | undefined) || null,
    coverage: budget.coverage,
    coverageThreshold: budget.coverageThreshold,
    pricedItems: budget.pricedItems,
    evidencedItems: budget.evidencedItems,
    scopeLines: budget.scopeLines,
    evidencedScopeLines: budget.evidencedScopeLines,
    components: budget.components,
    evidenceByTier: budget.byTier,
    estimatedTotals: budget.totals,
    payingParty: budget.payingParty,
    scopeNote: budget.scopeNote,
    priceBandsKnown: banded.length,
    bandDistribution: bands,
    bandSource: banded[0]?.priceBand?.source || null
  };

  const paceLoad: PaceLoadEntry[] = itinerary.days.map((d) => ({
    day: d.dayNumber,
    stops: d.items.filter((i) => i.type !== "rest").length,
    walkingKmEstimated: +d.legs
      .filter((l) => l.mode === "walk")
      .reduce((s, l) => s + l.km, 0)
      .toFixed(2),
    lastEnd: fmt(d.endMin)
  }));

  return {
    recordedAt: opts.now ?? new Date().toISOString(),
    engineStage: "PREDICT",
    highlights,
    risks,
    budgetPosture,
    paceLoad,
    learnContract:
      "Post-trip verdicts (kept / changed / skipped per item, plus traveler rating) are graded against this record and fed to the production patterns library per CONTRACTS.md — the shadow build defines the intake, it does not rebuild the library."
  };
}
