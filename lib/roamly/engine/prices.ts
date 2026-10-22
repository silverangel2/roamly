import { fmt } from "@/lib/roamly/engine/util";
import type { EngineItem } from "@/lib/roamly/engine/util";
import type { CurrencyCode, PerBasis } from "@/lib/roamly/engine/money";
import { PRICE_POLICY_VERSION } from "@/lib/roamly/engine/types";
import type { BudgetVerdict, PricedCategory, TravelersDTO } from "@/lib/roamly/engine/types";
import { buildBudgetScope, LODGING_BAND_RANGES } from "@/lib/roamly/engine/budgetScope";
import type { BudgetComponentLine, BudgetScopeInputs } from "@/lib/roamly/engine/budgetScope";

/*
 * prices — the price layer (Phase 2 port of the shadow zero-engine's
 * prices.mjs, WS-PRICES, owner fix-the-four, 2026-10-21).
 *
 * Open data carries no prices and this engine NEVER invents one. What
 * it can do — what the transport argument already does for one
 * scenario — is reason over labeled evidence. Every priced thing in a
 * plan gets exactly one evidence record, from a strict hierarchy:
 *
 *   VERIFIED  a real recorded price (owner library / booked price).
 *   BAND      a Google price level (live or fixture provenance rides
 *             along) mapped to a labeled currency RANGE per category.
 *   COSTED    a category cost model in the transport argument's
 *             style: per-kind per-person ranges with every assumption
 *             written down and labeled ESTIMATED.
 *   UNKNOWN   no evidence. Never zero, never guessed — range is null.
 *
 * Ranges live in reports and the PREDICT record only. Traveler
 * surfaces render no prices at all (standing card design) — and never
 * a point price derived from a range.
 *
 * Per the production design, the band table, the cost model, and the
 * coverage threshold are VERSIONED CONFIGURATION (PRICE_POLICY below,
 * stamped with the Phase 1 PRICE_POLICY_VERSION), not literals
 * scattered through the logic: a policy change is a new version,
 * never a silent edit.
 *
 * ALL-IN SCOPE (owner decision, Junel, 2026-10-22): the budget verdict
 * prices the ALL-IN scope — plan items + lodging + transport-to-
 * destination — through the ONE scope definition in budgetScope.ts,
 * which the Budget-vs-Real reckoning consumes too, so the two can
 * never disagree about what the budget covers. A component with no
 * evidence is excluded from the totals and NAMED in the scope note —
 * never counted as zero. Adding the lodging band table to the policy
 * was a policy change: PRICE_POLICY_VERSION prices-1 -> prices-2.
 */

export type PriceTierName = "VERIFIED" | "BAND" | "COSTED" | "UNKNOWN";
export const PRICE_TIERS: readonly PriceTierName[] = ["VERIFIED", "BAND", "COSTED", "UNKNOWN"];

/* ------------------------------------------------------------------ */
/* Versioned policy configuration                                      */
/* ------------------------------------------------------------------ */

export interface PricePolicyConfig {
  version: string;
  /** A stated majority of priced items must carry evidence. */
  coverageThreshold: number;
  currency: CurrencyCode;
  /** Google price level -> [low, high] per-person ranges, per category. */
  bandRanges: Record<PricedCategory, Record<string, readonly [number, number]>>;
  /** Per-person cost model by model key (category key or item kind). */
  costModel: Record<string, { range: readonly [number, number]; basis: string }>;
  /** ALL-IN scope (2026-10-22): price band level -> per room-night CAD
   *  range for the LODGING component (defined in budgetScope.ts, carried
   *  here so the whole price policy stays one versioned object). */
  lodgingBandRanges: Record<string, { low: number; high: number }>;
}

/* ---- BAND table: Google price level -> CAD range per category ----
   Google's levels are relative (a $$ cafe is not a $$ tasting menu),
   so the mapping is per category. Every cell is ESTIMATED — a
   generalized North-American urban range, stated as a model. */
const BAND_RANGES: PricePolicyConfig["bandRanges"] = {
  meal: {
    PRICE_LEVEL_FREE: [0, 0],
    PRICE_LEVEL_INEXPENSIVE: [8, 18],
    PRICE_LEVEL_MODERATE: [18, 35],
    PRICE_LEVEL_EXPENSIVE: [35, 60],
    PRICE_LEVEL_VERY_EXPENSIVE: [60, 110]
  },
  admission: {
    PRICE_LEVEL_FREE: [0, 0],
    PRICE_LEVEL_INEXPENSIVE: [0, 12],
    PRICE_LEVEL_MODERATE: [12, 28],
    PRICE_LEVEL_EXPENSIVE: [28, 50],
    PRICE_LEVEL_VERY_EXPENSIVE: [50, 90]
  },
  crossing: {
    PRICE_LEVEL_FREE: [0, 0],
    PRICE_LEVEL_INEXPENSIVE: [5, 12],
    PRICE_LEVEL_MODERATE: [12, 25],
    PRICE_LEVEL_EXPENSIVE: [25, 45],
    PRICE_LEVEL_VERY_EXPENSIVE: [45, 80]
  }
};

/* ---- COSTED model: per-person CAD ranges by item kind ----
   The transport argument's discipline generalized: each row is an
   assumption with a basis, labeled ESTIMATED wherever it is used. */
const COST_MODEL: PricePolicyConfig["costModel"] = {
  meal: { range: [12, 30], basis: "ESTIMATED — casual restaurant meal, per person, CAD (cost model assumption; no venue data)" },
  museum: { range: [12, 26], basis: "ESTIMATED — museum admission, per person, CAD (cost model assumption)" },
  gallery: { range: [8, 20], basis: "ESTIMATED — gallery admission, per person, CAD (cost model assumption; many galleries sit at the low end)" },
  attraction: { range: [15, 35], basis: "ESTIMATED — ticketed attraction admission, per person, CAD (cost model assumption)" },
  venue: { range: [15, 40], basis: "ESTIMATED — venue/theatre admission, per person, CAD (cost model assumption)" },
  falls: { range: [10, 25], basis: "ESTIMATED — falls site entry/parking share, per person, CAD (cost model assumption)" },
  lighthouse: { range: [8, 18], basis: "ESTIMATED — lighthouse site admission, per person, CAD (cost model assumption)" },
  ferry: { range: [8, 20], basis: "ESTIMATED — harbour ferry fare, per person, CAD (cost model assumption; sailing times and fares are the terminal board's)" }
};

export const PRICE_POLICY: PricePolicyConfig = {
  version: PRICE_POLICY_VERSION,
  coverageThreshold: 0.5, // a stated majority of priced items
  currency: "CAD",
  bandRanges: BAND_RANGES,
  costModel: COST_MODEL,
  lodgingBandRanges: LODGING_BAND_RANGES
};

export const COVERAGE_THRESHOLD: number = PRICE_POLICY.coverageThreshold;
export { BAND_RANGES, COST_MODEL };

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/** The core's evidence record (the Phase 1 PriceEvidenceDTO shape,
 *  with the range in its plain {low, high, currency} form). */
export interface PriceEvidenceRecord {
  tier: PriceTierName;
  category: PricedCategory;
  range: { low: number; high: number; currency: CurrencyCode } | null;
  per: PerBasis;
  basis: string;
}

/** A library VERIFIED price, keyed by candidate key (the shape the
 *  ladder's top tier consumes — the Budget-vs-Real store's judge view). */
export interface LibraryPrice {
  amount: number;
  per?: PerBasis;
  currency?: CurrencyCode;
  source?: string;
  recordedAt?: string | null;
}

export type LibraryPriceMap = Record<string, LibraryPrice>;

/** What category of priced thing is this item — or is it not priced? */
export function pricedCategory(item: EngineItem | null | undefined): PricedCategory | null {
  if (!item || item.type === "rest") return null;
  if (item.type === "food") return "meal";
  if (item.kind === "ferry") return "crossing";
  if (["museum", "gallery", "attraction", "venue", "falls", "lighthouse"].includes(item.kind || ""))
    return "admission";
  return null; // parks, viewpoints, historic open-air sites, markets: the
  // plan expects no payment at the door, so they are not priced items.
  // (Optional spend exists in real life; the judge prices what the
  // plan commits the traveler to, and says so.)
}

const CATEGORY_MODEL_KEY: Record<PricedCategory, string | null> = {
  meal: "meal",
  crossing: "ferry",
  admission: null
};

export interface PriceEvidenceOptions {
  libraryPrices?: LibraryPriceMap;
  policy?: PricePolicyConfig;
  /** ALL-IN scope inputs (lodging + getting-there evidence), consumed
   *  by judgeBudget through budgetScope.buildBudgetScope. Absent =>
   *  both components carry no evidence: named, excluded, and coverage
   *  is still computed over the all-in scope. */
  scope?: BudgetScopeInputs | null;
}

/**
 * Evidence for one item. Returns { tier, category, range, per, basis }
 * or null when the item is not a priced item. Ranges are PER PERSON
 * except VERIFIED-party records. UNKNOWN => range null, never zero.
 */
export function priceEvidence(
  item: EngineItem,
  opts: PriceEvidenceOptions = {}
): PriceEvidenceRecord | null {
  const policy = opts.policy ?? PRICE_POLICY;
  const libraryPrices = opts.libraryPrices ?? {};
  const category = pricedCategory(item);
  if (!category) return null;
  // An evidence record already attached to the item (the pipeline
  // attaches one at build time) is the record of truth for that item —
  // the judge grades what was recorded, it does not silently re-derive.
  if (item.priceEvidence && PRICE_TIERS.includes(item.priceEvidence.tier)) {
    const ev = item.priceEvidence;
    return {
      tier: ev.tier,
      category: ev.category || category,
      range: ev.range || null,
      per: ev.per || "person",
      basis: ev.basis || "recorded at build time"
    };
  }
  const lib = item.key ? libraryPrices[item.key] : null;
  if (lib && typeof lib.amount === "number") {
    return {
      tier: "VERIFIED",
      category,
      range: { low: lib.amount, high: lib.amount, currency: lib.currency || "CAD" },
      per: lib.per || "person",
      basis: `recorded price — ${lib.source || "owner library"}${lib.recordedAt ? ` (${lib.recordedAt})` : ""}`
    };
  }
  const level = item.priceBand?.level || item.google?.priceLevel || null;
  const band = level ? policy.bandRanges[category]?.[level] : undefined;
  if (level && band) {
    const [low, high] = band;
    return {
      tier: "BAND",
      category,
      range: { low, high, currency: policy.currency },
      per: "person",
      basis: `ESTIMATED — Google price level ${level.replace("PRICE_LEVEL_", "")} (${item.priceBand?.source || item.google?.source || "google"}) mapped to a ${category} range; a band, never an exact price`
    };
  }
  const modelKey = CATEGORY_MODEL_KEY[category] || item.kind || "";
  const model = policy.costModel[modelKey];
  if (model) {
    return {
      tier: "COSTED",
      category,
      range: { low: model.range[0], high: model.range[1], currency: policy.currency },
      per: "person",
      basis: model.basis
    };
  }
  return {
    tier: "UNKNOWN",
    category,
    range: null,
    per: "person",
    basis: "no evidence — never zero, never guessed"
  };
}

/* ------------------------------------------------------------------ */
/* The budget judge                                                    */
/* ------------------------------------------------------------------ */

export interface BudgetJudgeItem {
  day: number;
  name: string | undefined;
  kind: string;
  category: PricedCategory;
  tier: PriceTierName;
  basis: string;
  partyRange: { low: number; high: number; currency: CurrencyCode } | null;
}

export interface BudgetJudgeResult {
  verdict: BudgetVerdict;
  verdictReason: string;
  cap: { amount: number; currency: CurrencyCode } | null;
  /** Coverage over the ALL-IN scope (priced plan items + applicable
   *  component lines) since the 2026-10-22 owner decision. */
  coverage: number;
  coverageThreshold: number;
  pricedItems: number;
  evidencedItems: number;
  /** ALL-IN scope lines (pricedItems + applicable components) and how
   *  many of them carry evidence. */
  scopeLines: number;
  evidencedScopeLines: number;
  /** The lodging + getting-there scope lines, with their evidence. */
  components: BudgetComponentLine[];
  byTier: Record<string, number>;
  totals: { low: number; high: number; currency: CurrencyCode };
  payingParty: number;
  scopeNote: string;
  perItem: BudgetJudgeItem[];
}

export interface BudgetJudgeItinerary {
  travelers?: TravelersDTO;
  budgetCap?: { amount: number; currency: CurrencyCode } | null;
  days?: { dayNumber: number; items?: EngineItem[] }[];
}

/**
 * The budget judge — ALL-IN scope (owner decision, 2026-10-22).
 * Compares the trip's all-in estimated cost against the cap: the
 * plan's priced items (meals, admissions, crossings) PLUS lodging and
 * transport TO the destination, folded in through the one scope
 * definition in budgetScope.ts (the Budget-vs-Real reckoning consumes
 * the same scope). A component with no evidence is excluded from the
 * totals and named in `scopeNote` — never counted as zero.
 * Verdict: coverage <= threshold -> UNVERIFIABLE (coverage stated);
 * totals entirely under the cap -> WITHIN; entirely over -> OVER;
 * straddling -> AT RISK.
 */
export function judgeBudget(
  itinerary: BudgetJudgeItinerary,
  opts: PriceEvidenceOptions = {}
): BudgetJudgeResult {
  const policy = opts.policy ?? PRICE_POLICY;
  const libraryPrices = opts.libraryPrices ?? {};
  const travelers: TravelersDTO = itinerary.travelers || { adults: 2, children: 0, infants: 0 };
  const payingParty = (travelers.adults || 0) + (travelers.children || 0); // infants pay no admission and eat no bought meal — labeled assumption
  const cap = itinerary.budgetCap?.amount ?? null;
  const currency: CurrencyCode = itinerary.budgetCap?.currency || "CAD";
  const perItem: BudgetJudgeItem[] = [];
  for (const day of itinerary.days || []) {
    for (const item of day.items || []) {
      const ev = priceEvidence(item, { libraryPrices, policy });
      if (!ev) continue;
      const factor = ev.per === "party" ? 1 : payingParty;
      perItem.push({
        day: day.dayNumber,
        name: item.name,
        kind: item.kind || item.type,
        category: ev.category,
        tier: ev.tier,
        basis: ev.basis,
        partyRange: ev.range
          ? { low: ev.range.low * factor, high: ev.range.high * factor, currency: ev.range.currency }
          : null
      });
    }
  }
  const pricedItems = perItem.length;
  const evidenced = perItem.filter((i) => i.tier !== "UNKNOWN");
  const planTotals = {
    low: evidenced.reduce((s, i) => s + (i.partyRange?.low || 0), 0),
    high: evidenced.reduce((s, i) => s + (i.partyRange?.high || 0), 0)
  };
  /* ALL-IN: fold lodging + getting-there through the shared scope. The
   * scope's totals are null only when NOTHING in the all-in scope
   * carries evidence; the result keeps its historical non-null shape
   * by stating 0–0 in that case (the verdict is UNVERIFIABLE then —
   * the 0–0 is never presented as a price). */
  const scope = buildBudgetScope(
    {
      pricedItems,
      evidencedItems: evidenced.length,
      planTotals: evidenced.length ? planTotals : null
    },
    (itinerary.days || []).length,
    opts.scope ?? null,
    policy.lodgingBandRanges
  );
  const totals = {
    low: scope.totals?.low ?? 0,
    high: scope.totals?.high ?? 0,
    currency
  };
  const coverageRaw = scope.scopeLines
    ? scope.evidencedScopeLines / scope.scopeLines
    : 0;
  let verdict: BudgetVerdict, verdictReason: string;
  if (cap == null) {
    verdict = "UNVERIFIABLE";
    verdictReason = "no budget cap was recorded for this trip";
  } else if (!pricedItems && !scope.components.some((c) => c.applicable && c.evidenced)) {
    verdict = "UNVERIFIABLE";
    verdictReason = "the plan carries no priced items to judge";
  } else if (coverageRaw <= policy.coverageThreshold) {
    verdict = "UNVERIFIABLE";
    verdictReason = `evidence covers ${scope.evidencedScopeLines} of ${scope.scopeLines} all-in scope lines (${Math.round(coverageRaw * 100)}%) — ${pricedItems} priced plan items + lodging + getting-there — not the stated majority (>${Math.round(policy.coverageThreshold * 100)}%) the verdict requires`;
  } else if (totals.high <= cap) {
    verdict = "WITHIN";
    verdictReason = `even the top of the estimated range (${currency} ${totals.high}) sits under the cap (${currency} ${cap})`;
  } else if (totals.low > cap) {
    verdict = "OVER";
    verdictReason = `even the bottom of the estimated range (${currency} ${totals.low}) exceeds the cap (${currency} ${cap})`;
  } else {
    verdict = "AT RISK";
    verdictReason = `the estimated range (${currency} ${totals.low}–${totals.high}) straddles the cap (${currency} ${cap})`;
  }
  const byTier: Record<string, number> = {};
  for (const i of perItem) byTier[i.tier] = (byTier[i.tier] || 0) + 1;
  for (const c of scope.components) {
    if (c.applicable && c.evidenced) byTier[c.evidence.tier] = (byTier[c.evidence.tier] || 0) + 1;
  }
  return {
    verdict,
    verdictReason,
    cap: cap == null ? null : { amount: cap, currency },
    coverage: scope.coverage,
    coverageThreshold: policy.coverageThreshold,
    pricedItems,
    evidencedItems: evidenced.length,
    scopeLines: scope.scopeLines,
    evidencedScopeLines: scope.evidencedScopeLines,
    components: scope.components,
    byTier,
    totals,
    payingParty,
    scopeNote: scope.scopeNote,
    perItem
  };
}

export const fmtMoney = (n: number, currency: CurrencyCode = "CAD"): string =>
  `${currency} ${Math.round(n)}`;
export { fmt };
