/* ================================================================== */
/* budgetScope.ts — THE ALL-IN BUDGET SCOPE (one definition, two      */
/* consumers).                                                         */
/*                                                                    */
/* Owner decision (Junel, 2026-10-22 11:12 ADT): "Budget scope —      */
/* all-in, update." The budget verdict (prices.judgeBudget) and the   */
/* Budget-vs-Real reckoning (budgetVsReal BEFORE/DURING/AFTER) used   */
/* to price ONLY what the plan commits the traveler to in the         */
/* destination (meals, admissions, crossings). They now share ONE     */
/* all-in scope:                                                      */
/*                                                                    */
/*   plan items (meals, admissions, crossings)                        */
/*   + LODGING — the booked stay's cost evidence                      */
/*   + TRANSPORT-TO-DESTINATION ("getting-there") — the transport     */
/*     argument's all-in money (fare/fuel + parking + transfers)      */
/*                                                                    */
/* Both consumers build their scope through THIS module, so the       */
/* judge and the reckoning can never disagree about what the budget   */
/* covers. The evidence ladder does NOT change (VERIFIED > BAND >     */
/* COSTED > UNKNOWN) and the parser law does NOT change: UNKNOWN      */
/* carries range === null. A component with no evidence is EXCLUDED   */
/* from the totals and NAMED in the scope note — never counted as     */
/* zero. Coverage is recomputed over the all-in scope lines and       */
/* stated. Verdict language is unchanged.                             */
/*                                                                    */
/* Lodging evidence ladder:                                           */
/*   booked price (a booking fact — VERIFIED, whole-stay party total) */
/*   > library price for the stay (VERIFIED)                          */
/*   > the stay record's price band (BAND via the versioned           */
/*     lodgingBandRanges table in prices.PRICE_POLICY — per           */
/*     room-night CAD, ESTIMATED, one room assumed)                   */
/*   > UNKNOWN (named, excluded).                                     */
/* There is deliberately NO generic costed lodging model: inventing   */
/* a per-night range for the trip's largest cost, from no stay data   */
/* at all, is exactly the manufactured number this engine refuses     */
/* everywhere else.                                                   */
/*                                                                    */
/* Transport evidence ladder:                                         */
/*   booked fare (a booking fact — VERIFIED)                          */
/*   > the transport argument's all-in money for the selected /       */
/*     better-scoring option (COSTED; its basis also carries the      */
/*     effective cost, which adds the labeled value of travel time —  */
/*     the verdict prices MONEY, the basis carries both figures)      */
/*   > UNKNOWN when both options were emitted with no selection       */
/*     recorded, or when no estimate exists (named, excluded).       */
/* ================================================================== */

import type { PriceTier } from "@/lib/roamly/engine/types";
import type { MoneyRange } from "@/lib/roamly/engine/money";
import type { TransportEstimate } from "@/lib/roamly/engine/anchors";

export type BudgetComponent = "lodging" | "transport";

export interface ScopeMoneyInput {
  amount: number;
  currency: string;
}

export interface LodgingScopeInput {
  /** The stay's name, when one is resolved (booked or anchor stay). */
  name?: string | null;
  /** The stay candidate's stable key, when known. */
  candidateKey?: string | null;
  /** Overnight count; derived as trip days − 1 when not supplied. */
  nights?: number | null;
  /** The stay record's price band level (OSM price_band / Google priceLevel), when recorded. */
  priceBandLevel?: string | null;
  /** Where the band came from: "google" | "osm" (anything else reads as a recorded band). */
  priceBandSource?: string | null;
  /** The booked stay's recorded whole-stay price — a booking fact (VERIFIED). */
  bookedPrice?: ScopeMoneyInput | null;
  /** A verified whole-stay price for this stay from Roamly's priced library (VERIFIED). */
  libraryPrice?: (ScopeMoneyInput & { evidenceCount?: number | null }) | null;
}

export interface TransportScopeInput {
  /** Display name for the leg, when the caller has one. */
  name?: string | null;
  /** The traveler's recorded selection, when one exists. */
  mode?: "drive" | "flight" | null;
  /** anchors.estimateTransport output for this trip, when computed. */
  estimate?: TransportEstimate | null;
  /** The booked fare's recorded price — a booking fact (VERIFIED). */
  bookedPrice?: ScopeMoneyInput | null;
}

export interface BudgetScopeInputs {
  lodging?: LodgingScopeInput | null;
  transport?: TransportScopeInput | null;
}

/** Component-level evidence: the PriceEvidenceRecord shape minus the
 *  plan-item category (components are scope lines, not plan items).
 *  Law kept: tier UNKNOWN ⇒ range === null. */
export interface ComponentEvidence {
  tier: PriceTier;
  range: MoneyRange | null;
  basis: string;
  source: "booking" | "library" | "google" | "osm" | "cost-model" | "none";
}

export interface BudgetComponentLine {
  component: BudgetComponent;
  name: string;
  /** False only for lodging on a trip with no overnight stay (day trip):
   *  the line leaves the scope entirely — it is not a missing-evidence
   *  gap and is never counted in coverage. */
  applicable: boolean;
  evidenced: boolean;
  evidence: ComponentEvidence;
  /** Lodging only: the overnight count the evidence was priced over. */
  nights: number | null;
}

export interface BudgetScope {
  components: BudgetComponentLine[];
  /** Priced plan items + applicable component lines. */
  scopeLines: number;
  /** Scope lines carrying evidence (range !== null). */
  evidencedScopeLines: number;
  /** evidencedScopeLines / scopeLines, 2dp; 0 when the scope is empty. */
  coverage: number;
  /** Plan totals + evidenced component ranges; null when nothing in
   *  the all-in scope carries evidence. */
  totals: { low: number; high: number; currency: "CAD" } | null;
  scopeNote: string;
}

/* Per room-night CAD ranges for a stay's recorded price band. Part of
 * the versioned price policy (prices.PRICE_POLICY carries this table;
 * the policy version bumped to prices-2 when this table landed). Both
 * the plain band words and Google's PRICE_LEVEL_* enum values resolve. */
export const LODGING_BAND_RANGES: Record<string, { low: number; high: number }> = {
  FREE: { low: 0, high: 0 },
  PRICE_LEVEL_FREE: { low: 0, high: 0 },
  INEXPENSIVE: { low: 60, high: 110 },
  PRICE_LEVEL_INEXPENSIVE: { low: 60, high: 110 },
  MODERATE: { low: 110, high: 180 },
  PRICE_LEVEL_MODERATE: { low: 110, high: 180 },
  EXPENSIVE: { low: 180, high: 300 },
  PRICE_LEVEL_EXPENSIVE: { low: 180, high: 300 },
  VERY_EXPENSIVE: { low: 300, high: 550 },
  PRICE_LEVEL_VERY_EXPENSIVE: { low: 300, high: 550 }
};

function fmtCad(n: number): string {
  return `CAD ${+n.toFixed(2)}`;
}

function pointRange(amount: number): MoneyRange {
  // The engine prices in CAD end-to-end (PRICE_POLICY.currency); a
  // recorded price enters at face value, exactly as the reckoning's
  // reals already do.
  return { low: +amount.toFixed(2), high: +amount.toFixed(2), currency: "CAD", per: "party" };
}

/* ------------------------------------------------------------------ */
/* Lodging                                                            */
/* ------------------------------------------------------------------ */

export function resolveLodgingLine(
  input: LodgingScopeInput | null | undefined,
  tripDays: number,
  bandRanges: Record<string, { low: number; high: number }> = LODGING_BAND_RANGES
): BudgetComponentLine {
  const nights = input?.nights != null ? input.nights : Math.max(0, tripDays - 1);
  const name = input?.name ? `Lodging — ${input.name}` : "Lodging (the booked stay)";
  if (nights <= 0) {
    return {
      component: "lodging",
      name,
      applicable: false,
      evidenced: false,
      evidence: {
        tier: "UNKNOWN",
        range: null,
        basis:
          "day trip — no overnight stay, so lodging is not part of this trip's all-in scope (not a missing-evidence gap and never counted)",
        source: "none"
      },
      nights
    };
  }
  if (input?.bookedPrice) {
    return {
      component: "lodging",
      name,
      applicable: true,
      evidenced: true,
      evidence: {
        tier: "VERIFIED",
        range: pointRange(input.bookedPrice.amount),
        basis: `the booked stay's recorded price — a booking fact (whole stay, ${nights} night${nights === 1 ? "" : "s"}, whole party)`,
        source: "booking"
      },
      nights
    };
  }
  if (input?.libraryPrice) {
    return {
      component: "lodging",
      name,
      applicable: true,
      evidenced: true,
      evidence: {
        tier: "VERIFIED",
        range: pointRange(input.libraryPrice.amount),
        basis: `Roamly's priced library holds a verified whole-stay price for this stay${input.libraryPrice.evidenceCount ? ` (${input.libraryPrice.evidenceCount} recorded prices)` : ""} — ${nights} night${nights === 1 ? "" : "s"}, whole party`,
        source: "library"
      },
      nights
    };
  }
  const level = (input?.priceBandLevel ?? "").toUpperCase();
  const band = level ? bandRanges[level] : undefined;
  if (band) {
    const fromGoogle = (input?.priceBandSource ?? "").toLowerCase() === "google";
    return {
      component: "lodging",
      name,
      applicable: true,
      evidenced: true,
      evidence: {
        tier: "BAND",
        range: {
          low: +(band.low * nights).toFixed(2),
          high: +(band.high * nights).toFixed(2),
          currency: "CAD",
          per: "party"
        },
        basis: `the stay's recorded ${level} price band (${fromGoogle ? "Google price level" : "recorded on the stay"}) priced at ${fmtCad(band.low)}–${fmtCad(band.high)} per room-night × ${nights} night${nights === 1 ? "" : "s"} — an ESTIMATED range, never a point price; one room assumed`,
        source: fromGoogle ? "google" : "osm"
      },
      nights
    };
  }
  return {
    component: "lodging",
    name,
    applicable: true,
    evidenced: false,
    evidence: {
      tier: "UNKNOWN",
      range: null,
      basis:
        "no price evidence for the stay — no booked price, no library price, no recorded price band. Named and excluded from the totals (never counted as zero)",
      source: "none"
    },
    nights
  };
}

/* ------------------------------------------------------------------ */
/* Transport-to-destination                                           */
/* ------------------------------------------------------------------ */

export function resolveTransportLine(
  input: TransportScopeInput | null | undefined
): BudgetComponentLine {
  const estimate = input?.estimate ?? null;
  const name =
    input?.name ?? (estimate ? `Getting there — ${estimate.scenario}` : "Getting there (transport to the destination)");
  if (input?.bookedPrice) {
    return {
      component: "transport",
      name,
      applicable: true,
      evidenced: true,
      evidence: {
        tier: "VERIFIED",
        range: pointRange(input.bookedPrice.amount),
        basis: "the booked fare's recorded price — a booking fact (whole party)",
        source: "booking"
      },
      nights: null
    };
  }
  if (estimate) {
    const mode =
      input?.mode ??
      (estimate.bothOptionsEmitted
        ? null
        : estimate.verdict.startsWith("drive")
          ? "drive"
          : estimate.verdict.startsWith("flight")
            ? "flight"
            : null);
    if (mode) {
      const opt = estimate[mode];
      const assumptionText = Object.entries(estimate.assumptions)
        .map(([k, a]) => `${k} ${a.value} (${a.basis})`)
        .join("; ");
      return {
        component: "transport",
        name,
        applicable: true,
        evidenced: true,
        evidence: {
          tier: "COSTED",
          range: { low: +opt.money.toFixed(2), high: +opt.money.toFixed(2), currency: "CAD", per: "party" },
          basis:
            `the transport argument's all-in money estimate for the ${mode} option` +
            `${input?.mode ? " (the traveler's recorded selection)" : " (the option the argument scores better — no traveler selection recorded)"}: ` +
            `money ${fmtCad(opt.money)} — fare/fuel plus parking and transfers, never a bare fare. ` +
            `Its effective cost ${fmtCad(opt.effectiveCost)} additionally counts ${opt.hours} h of travel time at the labeled value of time; the verdict prices money and this basis carries both figures. ` +
            `Labeled assumptions: ${assumptionText}`,
          source: "cost-model"
        },
        nights: null
      };
    }
    return {
      component: "transport",
      name,
      applicable: true,
      evidenced: false,
      evidence: {
        tier: "UNKNOWN",
        range: null,
        basis:
          "the transport argument emitted both options (their effective costs sit within 20%) and no traveler selection is recorded — named and excluded from the totals (never counted as zero)",
        source: "none"
      },
      nights: null
    };
  }
  return {
    component: "transport",
    name,
    applicable: true,
    evidenced: false,
    evidence: {
      tier: "UNKNOWN",
      range: null,
      basis:
        "no transport estimate and no booked fare on record — named and excluded from the totals (never counted as zero)",
      source: "none"
    },
    nights: null
  };
}

/* ------------------------------------------------------------------ */
/* The scope note — the one canonical wording both consumers carry.   */
/* ------------------------------------------------------------------ */

function componentPhrase(line: BudgetComponentLine): string {
  if (!line.applicable) return "not applicable — day trip, no overnight stay";
  if (!line.evidenced) return "not evidenced — excluded from the totals, never counted as zero";
  if (line.component === "lodging") {
    return line.evidence.tier === "VERIFIED"
      ? "evidenced (VERIFIED — a recorded whole-stay price)"
      : "evidenced (BAND — the stay's recorded price band)";
  }
  return line.evidence.tier === "VERIFIED"
    ? "evidenced (VERIFIED — the booked fare)"
    : "evidenced (COSTED — the transport argument's all-in estimate)";
}

export function budgetScopeNote(components: BudgetComponentLine[]): string {
  const lodging = components.find((c) => c.component === "lodging");
  const transport = components.find((c) => c.component === "transport");
  return (
    "all-in scope — plan items (meals, admissions, crossings) + lodging + getting-there, " +
    "each priced from labeled evidence (bands and cost models are ESTIMATED ranges, never point prices); " +
    `lodging: ${lodging ? componentPhrase(lodging) : "not evidenced — excluded from the totals, never counted as zero"}; ` +
    `getting-there: ${transport ? componentPhrase(transport) : "not evidenced — excluded from the totals, never counted as zero"}.`
  );
}

/* ------------------------------------------------------------------ */
/* buildBudgetScope — fold the plan-item summary + the two component  */
/* lines into ONE scope: lines, coverage, totals, note.               */
/* ------------------------------------------------------------------ */

export function buildBudgetScope(
  plan: {
    pricedItems: number;
    evidencedItems: number;
    planTotals: { low: number; high: number } | null;
  },
  tripDays: number,
  inputs: BudgetScopeInputs | null | undefined,
  lodgingBandRanges?: Record<string, { low: number; high: number }>
): BudgetScope {
  const components = [
    resolveLodgingLine(inputs?.lodging ?? null, tripDays, lodgingBandRanges),
    resolveTransportLine(inputs?.transport ?? null)
  ];
  const applicable = components.filter((c) => c.applicable);
  const scopeLines = plan.pricedItems + applicable.length;
  const evidencedScopeLines =
    plan.evidencedItems + applicable.filter((c) => c.evidenced).length;
  const coverage = scopeLines ? +(evidencedScopeLines / scopeLines).toFixed(2) : 0;
  let totals: BudgetScope["totals"] = null;
  if (plan.planTotals || applicable.some((c) => c.evidenced)) {
    let low = plan.planTotals?.low ?? 0;
    let high = plan.planTotals?.high ?? 0;
    for (const c of applicable) {
      if (c.evidenced && c.evidence.range) {
        low += c.evidence.range.low;
        high += c.evidence.range.high;
      }
    }
    totals = { low: +low.toFixed(2), high: +high.toFixed(2), currency: "CAD" };
  }
  return {
    components,
    scopeLines,
    evidencedScopeLines,
    coverage,
    totals,
    scopeNote: budgetScopeNote(components)
  };
}
