import { COVERAGE_THRESHOLD, priceEvidence, pricedCategory } from "@/lib/roamly/engine/prices";
import type { PriceEvidenceRecord, PriceTierName } from "@/lib/roamly/engine/prices";
import { resolveLodgingLine, resolveTransportLine } from "@/lib/roamly/engine/budgetScope";
import type {
  BudgetComponent,
  BudgetScopeInputs,
  ComponentEvidence
} from "@/lib/roamly/engine/budgetScope";
import type { EngineItem } from "@/lib/roamly/engine/util";
import type { CurrencyCode, PerBasis } from "@/lib/roamly/engine/money";
import type {
  BudgetCheckpoint,
  BudgetVerdict,
  BudgetVsRealVerdict,
  PricedCategory,
  RealPriceSource,
  TravelersDTO
} from "@/lib/roamly/engine/types";
import { payingPartyOf } from "@/lib/roamly/engine/types";

/*
 * budgetVsReal — the Budget vs Real Price comparison module
 * (Phase 2 port of the shadow budget-vs-real bot, 2026-10-21;
 * Junel: "make a bot for budget vs real price.").
 *
 * The price layer (prices.ts) grades a plan against ESTIMATES: a
 * strict evidence ladder (VERIFIED > BAND > COSTED > UNKNOWN) and
 * judgeBudget's WITHIN / AT RISK / OVER / UNVERIFIABLE verdict.
 * Estimates are claims. This module hunts the REAL price for every
 * priced item and grades the claim against reality, at three
 * checkpoints:
 *
 *   BEFORE  plan-time: estimates vs library-verified + live-check
 *           evidence
 *   DURING  booking confirmations arrive (Gmail reconciliation
 *           facts): price PAID vs estimated, per item, as each
 *           booking lands
 *   AFTER   post-trip reckoning: as-lived real spend vs the budget —
 *           the final variance, and the calibration feed for the
 *           library
 *
 * REAL-PRICE SOURCES, trust order (a source is evidence, never a
 * guess; no source -> UNVERIFIABLE, and this module NEVER
 * manufactures a real price):
 *   1. PAID         the traveler's own booking confirmations /
 *                   post-trip actuals — the actual amount paid, exact.
 *   2. LIBRARY      recorded real prices from completed trips for
 *      VERIFIED     the same place/item — the store that feeds the
 *                   ladder's VERIFIED tier.
 *   3. LIVE-CHECK   a timestamped partner/market price observed at
 *                   check time. Evidence about NOW, not a promise:
 *                   it carries its observation time and a freshness
 *                   label, and a STALE check is excluded from every
 *                   total.
 *   4. NONE      -> UNVERIFIABLE. Excluded from real totals — never
 *                   zero.
 *
 * The module grades the SAME estimates the judge used: estimates are
 * priced by priceEvidence() with the library deliberately withheld
 * (inside this module the library is a REAL source, not an estimate
 * input), so a verdict here and a verdict in judgeBudget can never
 * silently disagree about what the plan claimed.
 *
 * CALIBRATION: every confirmed PAID price is written back to the
 * library price store in the ladder's VERIFIED shape, so the next
 * plan's judgeBudget reads reality instead of a model. Band/model
 * bias is PROPOSED from accumulated observations (>= 5, median
 * outside the modeled range) — recorded for owner review, NEVER
 * silently applied.
 *
 * LOUD LAW (Build 2 collision law, addition A): when real prices
 * re-grade the trip OVER its cap, the module flags it LOUD. Booking
 * truth busting the budget is never absorbed silently.
 *
 * Inputs consume the Phase 1 DTO family (plan items, library
 * records); outputs map one-to-one onto BudgetVsRealComparisonDTO.
 *
 * ALL-IN SCOPE (owner decision, Junel, 2026-10-22): the reckoning
 * covers the same all-in scope as the budget judge — plan items +
 * LODGING + TRANSPORT-TO-DESTINATION — through the one scope
 * definition in budgetScope.ts. Paid flight/hotel bookings (Gmail
 * facts / as-lived records, marked component: "transport" /
 * "lodging") are VERIFIED reals here: the booked price is the
 * component's own cost evidence, so the AFTER reckoning finally sees
 * the whole trip's money (the failure this fixes: a Halifax trip that
 * paid CAD 876 showed only CAD 40 of visible reals under the old
 * plan-items-only scope). A component with no evidence is named on
 * its component report and excluded from totals — never zero.
 * Calibration stays plan-item-only: component reals are booking
 * facts already on record, and the library's VERIFIED tier is keyed
 * to plan candidates.
 */

export const REAL_SOURCES: readonly RealPriceSource[] = ["PAID", "LIBRARY", "LIVE-CHECK"];
export const LIVE_CHECK_FRESH_HOURS = 24; // older than this, a live check is STALE
export const BIAS_MIN_OBSERVATIONS = 5;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const normName = (s: unknown): string =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dateOf = (iso: string): string => String(iso).slice(0, 10);

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** A priced plan item, in the plan-document's terms (the item key is
 *  the ladder's library key — the candidate key in production). */
export interface BvrItem {
  key?: string | null;
  candidateKey?: string | null;
  name?: string | null;
  kind?: string | null;
  type: string;
  priceBand?: { level: string; source: string } | null;
  priceEvidence?: PriceEvidenceRecord | null;
}

export interface BvrItinerary {
  tripRef?: string | null;
  travelers?: TravelersDTO;
  budgetCap?: { amount: number; currency: CurrencyCode } | null;
  days?: { dayNumber: number; items?: BvrItem[] }[];
  /** ALL-IN scope inputs (budgetScope.ts) — the lodging + getting-there
   *  evidence the reckoning grades alongside the plan items. */
  scope?: BudgetScopeInputs | null;
}

export interface PaidFact {
  itemKey?: string | null;
  name?: string | null;
  reference?: string | null;
  price?: { amount?: number; currency?: CurrencyCode; status?: string } | null;
  actual?: boolean;
  amount?: number;
  currency?: CurrencyCode;
  source?: string;
  /** ALL-IN: marks this fact as a scope COMPONENT's booking (a paid
   *  flight = "transport", a paid stay = "lodging") rather than a plan
   *  item's. Component facts never match plan items. */
  component?: BudgetComponent;
}

export interface LiveCheck {
  itemKey?: string | null;
  name?: string | null;
  amountPerPerson?: number;
  currency?: CurrencyCode;
  observedAt: string;
  source?: string;
}

export interface CheckpointContext {
  now?: string;
  bookingFacts?: PaidFact[];
  actuals?: PaidFact[];
  library?: LibraryStore | Record<string, LibraryRecord> | null;
  liveChecks?: LiveCheck[];
  outcomes?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Library price store — the VERIFIED tier's home.                     */
/* A record is exactly the shape priceEvidence consumes, plus the      */
/* evidence count the calibration contract requires.                   */
/* ------------------------------------------------------------------ */

export interface LibraryRecord {
  amount: number;
  currency: CurrencyCode;
  per: PerBasis;
  source: string;
  recordedAt: string | null;
  evidenceCount: number;
}

export interface LibraryStore {
  records: Record<string, LibraryRecord>;
  get(key: string | null | undefined): LibraryRecord | null;
  upsertConfirmed(
    key: string,
    rec: { amount: number; currency?: CurrencyCode; per?: PerBasis; source: string; recordedAt: string }
  ): LibraryRecord;
  toJudgeLibrary(): Record<string, { amount: number; per: PerBasis; currency: CurrencyCode; source: string; recordedAt: string | null }>;
}

export function createLibraryStore(
  seed: Record<string, Partial<LibraryRecord> & { amount: number }> = {}
): LibraryStore {
  const records: Record<string, LibraryRecord> = {};
  for (const [key, rec] of Object.entries(seed)) {
    records[key] = {
      amount: rec.amount,
      currency: rec.currency || "CAD",
      per: rec.per || "person",
      source: rec.source || "owner library",
      recordedAt: rec.recordedAt || null,
      evidenceCount: rec.evidenceCount ?? 1
    };
  }
  return {
    records,
    get(key) {
      return key ? records[key] || null : null;
    },
    /** Write one CONFIRMED real price. Latest confirmed price wins;
     *  the evidence count accumulates — it is the record's memory of
     *  how many real observations stand behind it. */
    upsertConfirmed(key, { amount, currency = "CAD", per = "party", source, recordedAt }) {
      const prev = records[key];
      records[key] = {
        amount,
        currency,
        per,
        source,
        recordedAt,
        evidenceCount: (prev?.evidenceCount || 0) + 1
      };
      return records[key];
    },
    /** Exactly the libraryPrices shape judgeBudget / priceEvidence
     *  read: { [key]: { amount, per, currency, source, recordedAt } }. */
    toJudgeLibrary() {
      const out: Record<string, { amount: number; per: PerBasis; currency: CurrencyCode; source: string; recordedAt: string | null }> = {};
      for (const [key, r] of Object.entries(records)) {
        out[key] = { amount: r.amount, per: r.per, currency: r.currency, source: r.source, recordedAt: r.recordedAt };
      }
      return out;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Real-price resolution, trust order PAID > LIBRARY > LIVE-CHECK.     */
/* Every amount is normalized to a PARTY total (what the plan commits   */
/* the whole paying party to), because booking confirmations state      */
/* party totals and judgeBudget compares party ranges.                  */
/* ------------------------------------------------------------------ */

export interface RealPrice {
  source: RealPriceSource;
  amountParty: number;
  currency: CurrencyCode;
  basis: string;
  reference: string | null;
  observedAt?: string;
  freshness?: "FRESH" | "STALE";
  excludedFromTotals?: boolean;
}

interface ResolveContext {
  now?: string;
  library: LibraryStore | Record<string, LibraryRecord> | null;
  liveChecks: LiveCheck[];
  paidFacts: PaidFact[];
}

function itemKeyOf(item: BvrItem): string | null {
  return item.key ?? item.candidateKey ?? null;
}

function matchFact<T extends { itemKey?: string | null; name?: string | null }>(
  item: BvrItem,
  facts: T[] | undefined
): T | null {
  if (!facts?.length) return null;
  const key = itemKeyOf(item);
  const byKey = facts.find((f) => f.itemKey && key && f.itemKey === key);
  if (byKey) return byKey;
  const n = normName(item.name);
  return facts.find((f) => f.name && normName(f.name) === n) || null;
}

export function resolveRealPrice(item: BvrItem, ctx: ResolveContext, payingParty: number): RealPrice | null {
  // 1. PAID — booking confirmations, then post-trip actuals. Exact.
  const fact = matchFact(item, ctx.paidFacts);
  if (fact && typeof fact.price?.amount === "number") {
    return {
      source: "PAID",
      amountParty: fact.price.amount,
      currency: fact.price.currency || "CAD",
      basis: fact.actual
        ? `price paid — post-trip actual (${fact.source || "traveler-confirmed"})`
        : `price paid — booking confirmation ${fact.reference || ""}`.trim(),
      reference: fact.reference || null
    };
  }
  if (fact && fact.actual && typeof fact.amount === "number") {
    return {
      source: "PAID",
      amountParty: fact.amount,
      currency: fact.currency || "CAD",
      basis: `price paid — post-trip actual (${fact.source || "traveler-confirmed"})`,
      reference: fact.reference || null
    };
  }
  // 2. LIBRARY VERIFIED — a recorded real price for this same item.
  const key = itemKeyOf(item);
  const lib: LibraryRecord | null =
    ctx.library && typeof (ctx.library as LibraryStore).get === "function"
      ? (ctx.library as LibraryStore).get(key)
      : key
        ? ((ctx.library as Record<string, LibraryRecord> | null)?.[key] ?? null)
        : null;
  if (lib && typeof lib.amount === "number") {
    return {
      source: "LIBRARY",
      amountParty: lib.per === "party" ? lib.amount : lib.amount * payingParty,
      currency: lib.currency || "CAD",
      basis: `recorded real price — ${lib.source || "owner library"}${lib.recordedAt ? ` (${lib.recordedAt})` : ""}; evidence count ${lib.evidenceCount ?? 1}`,
      reference: null
    };
  }
  // 3. LIVE-CHECK — a timestamped market observation. Freshness is
  //    part of the evidence: a stale check is labeled and excluded
  //    from totals.
  const check = matchFact(item, ctx.liveChecks);
  if (check && typeof check.amountPerPerson === "number") {
    const ageHours = (Date.parse(ctx.now ?? "") - Date.parse(check.observedAt)) / 36e5;
    const fresh = ageHours <= LIVE_CHECK_FRESH_HOURS;
    return {
      source: "LIVE-CHECK",
      amountParty: check.amountPerPerson * payingParty,
      currency: check.currency || "CAD",
      observedAt: check.observedAt,
      freshness: fresh ? "FRESH" : "STALE",
      excludedFromTotals: !fresh,
      basis: fresh
        ? `live check observed ${check.observedAt} (${check.source || "partner/market"}) — evidence about now, not a promise`
        : `live check observed ${check.observedAt} is ${Math.round(ageHours)}h old — STALE, labeled and excluded from totals; a stale price is evidence about then, not now`,
      reference: null
    };
  }
  return null; // 4. NONE -> UNVERIFIABLE. Never manufactured.
}

/* ------------------------------------------------------------------ */
/* Per-item grading. The estimate is the plan's own claim, priced by    */
/* priceEvidence with the library withheld (see header).                */
/* ------------------------------------------------------------------ */

export interface ItemEstimate {
  tier: PriceTierName;
  category: PricedCategory;
  basis: string;
  per: PerBasis;
  rangePerPerson: { low: number; high: number; currency: CurrencyCode } | null;
  partyRange: { low: number; high: number; currency: CurrencyCode } | null;
}

export interface ItemReport {
  key: string | null;
  name: string | null;
  day: number;
  category: PricedCategory;
  estimate: ItemEstimate;
  real: RealPrice | null;
  verdict: BudgetVsRealVerdict;
  verdictReason: string;
  loud: boolean;
}

function toEngineItem(item: BvrItem): EngineItem {
  return {
    type: item.type,
    start: 0,
    end: 0,
    key: itemKeyOf(item) ?? undefined,
    name: item.name ?? undefined,
    kind: item.kind ?? undefined,
    priceBand: item.priceBand ?? undefined,
    priceEvidence: item.priceEvidence ?? undefined
  };
}

export function gradeItem(
  item: BvrItem,
  dayNumber: number,
  ctx: ResolveContext & { outcomes?: Record<string, string> },
  payingParty: number
): ItemReport | null {
  const engineItem = toEngineItem(item);
  const category = pricedCategory(engineItem);
  if (!category) return null; // not a priced item — the plan commits no payment
  const ev = priceEvidence(engineItem, { libraryPrices: {} });
  if (!ev) return null;
  const estimate: ItemEstimate = ev.range
    ? {
        tier: ev.tier,
        category,
        basis: ev.basis,
        per: ev.per || "person",
        rangePerPerson:
          ev.per === "party" ? null : { low: ev.range.low, high: ev.range.high, currency: ev.range.currency },
        partyRange: {
          low: ev.range.low * (ev.per === "party" ? 1 : payingParty),
          high: ev.range.high * (ev.per === "party" ? 1 : payingParty),
          currency: ev.range.currency
        }
      }
    : { tier: ev.tier, category, basis: ev.basis, per: ev.per || "person", rangePerPerson: null, partyRange: null };
  const real = resolveRealPrice(item, ctx, payingParty);
  let verdict: BudgetVsRealVerdict, verdictReason: string;
  if (!real) {
    const key = itemKeyOf(item);
    const outcome = key ? ctx.outcomes?.[key] : undefined;
    verdict = "UNVERIFIABLE";
    verdictReason = outcome
      ? `no real price — item outcome ${outcome}; no spend recorded, nothing claimed`
      : "no real-price source (no booking, no library record, no live check) — never zero, never guessed";
  } else if (!estimate.partyRange) {
    verdict = "UNVERIFIABLE";
    verdictReason = `a real price exists (${real.source}) but the plan carried no estimate range to grade it against`;
  } else if (real.amountParty > estimate.partyRange.high) {
    verdict = "ABOVE";
    verdictReason = `real ${real.currency} ${real.amountParty} is above the estimated range ${estimate.partyRange.low}–${estimate.partyRange.high}`;
  } else if (real.amountParty < estimate.partyRange.low) {
    verdict = "BELOW";
    verdictReason = `real ${real.currency} ${real.amountParty} is below the estimated range ${estimate.partyRange.low}–${estimate.partyRange.high}`;
  } else {
    verdict = "INSIDE-RANGE";
    verdictReason = `real ${real.currency} ${real.amountParty} sits inside the estimated range ${estimate.partyRange.low}–${estimate.partyRange.high}`;
  }
  return {
    key: itemKeyOf(item),
    name: item.name || null,
    day: dayNumber,
    category,
    estimate,
    real,
    verdict,
    verdictReason,
    loud: verdict === "ABOVE"
  };
}

/* ------------------------------------------------------------------ */
/* ALL-IN components — lodging + getting-there, graded with the same   */
/* discipline as plan items. The ESTIMATE comes from the shared scope  */
/* definition (budgetScope.ts): the booked stay's cost evidence / the  */
/* transport argument's all-in estimate. The REAL is the component's   */
/* own PAID booking fact (trust #1). When the scope carries no         */
/* estimate evidence but a paid fact exists, the booked price IS the   */
/* component's cost evidence (VERIFIED) — that is what makes paid      */
/* flight/hotel bookings visible to the reckoning.                     */
/* ------------------------------------------------------------------ */

export interface ComponentReport {
  component: BudgetComponent;
  name: string;
  /** False only for lodging on a trip with no overnight stay — the
   *  line is outside the scope entirely, never a missing-evidence gap. */
  applicable: boolean;
  estimate: {
    tier: PriceTierName;
    basis: string;
    partyRange: { low: number; high: number; currency: CurrencyCode } | null;
  };
  real: RealPrice | null;
  verdict: BudgetVsRealVerdict;
  verdictReason: string;
  excludedFromTotals: boolean;
}

export function gradeComponent(
  component: BudgetComponent,
  itinerary: BvrItinerary,
  componentFacts: PaidFact[]
): ComponentReport {
  const days = (itinerary.days || []).length;
  const line =
    component === "lodging"
      ? resolveLodgingLine(itinerary.scope?.lodging ?? null, days)
      : resolveTransportLine(itinerary.scope?.transport ?? null);
  const ev: ComponentEvidence = line.evidence;
  let estimate: ComponentReport["estimate"] = {
    tier: ev.tier,
    basis: ev.basis,
    partyRange: ev.range
      ? { low: ev.range.low, high: ev.range.high, currency: ev.range.currency }
      : null
  };
  // The component's REAL: its own paid booking fact (checkpoint gating
  // happened in runCheckpoint — BEFORE never sees paid facts).
  let real: RealPrice | null = null;
  for (const f of componentFacts) {
    const amount =
      typeof f.price?.amount === "number"
        ? f.price.amount
        : f.actual && typeof f.amount === "number"
          ? f.amount
          : null;
    if (amount == null) continue;
    real = {
      source: "PAID",
      amountParty: amount,
      currency: f.price?.currency || f.currency || "CAD",
      basis: f.actual
        ? `price paid — post-trip actual (${f.source || "traveler-confirmed"})`
        : `price paid — booking confirmation ${f.reference || ""}`.trim(),
      reference: f.reference || null
    };
    break;
  }
  if (!estimate.partyRange && real) {
    estimate = {
      tier: "VERIFIED",
      basis:
        "the booked price itself is this component's cost evidence — a booking fact (VERIFIED); no separate estimate was on record",
      partyRange: { low: real.amountParty, high: real.amountParty, currency: real.currency }
    };
  }
  let verdict: BudgetVsRealVerdict, verdictReason: string;
  if (!line.applicable) {
    verdict = "UNVERIFIABLE";
    verdictReason = ev.basis;
  } else if (!real) {
    verdict = "UNVERIFIABLE";
    verdictReason =
      "no real price — no booking fact for this component (nothing booked yet, or the booking never reached reconciliation); never zero, never guessed";
  } else if (!estimate.partyRange) {
    verdict = "UNVERIFIABLE";
    verdictReason = "a real price exists (PAID) but the scope carried no estimate range to grade it against";
  } else if (real.amountParty > estimate.partyRange.high) {
    verdict = "ABOVE";
    verdictReason = `real ${real.currency} ${real.amountParty} is above the estimated range ${estimate.partyRange.low}–${estimate.partyRange.high}`;
  } else if (real.amountParty < estimate.partyRange.low) {
    verdict = "BELOW";
    verdictReason = `real ${real.currency} ${real.amountParty} is below the estimated range ${estimate.partyRange.low}–${estimate.partyRange.high}`;
  } else {
    verdict = "INSIDE-RANGE";
    verdictReason = `real ${real.currency} ${real.amountParty} sits inside the estimated range ${estimate.partyRange.low}–${estimate.partyRange.high}`;
  }
  return {
    component,
    name: line.name,
    applicable: line.applicable,
    estimate,
    real,
    verdict,
    verdictReason,
    excludedFromTotals: !line.applicable
  };
}

/* ------------------------------------------------------------------ */
/* Re-grade: judgeBudget's verdict language, recomputed with real      */
/* prices substituted wherever reality is known. A real price is a     */
/* point: it replaces BOTH ends of that item's estimated range.         */
/* ALL-IN (2026-10-22): the re-grade runs over the all-in scope —       */
/* evidenced component lines fold into the totals and the coverage     */
/* denominator exactly as judgeBudget's scope does (budgetScope.ts).   */
/* ------------------------------------------------------------------ */

export interface RegradeResult {
  verdict: BudgetVerdict;
  verdictReason: string;
  cap: { amount: number; currency: CurrencyCode } | null;
  totals: { low: number; high: number; currency: CurrencyCode };
  coverage: number;
  pricedItems: number;
  evidencedItems: number;
  realItems: number;
  estimatedItems: number;
}

export function regradeBudget(
  itinerary: BvrItinerary,
  itemReports: ItemReport[],
  componentReports: ComponentReport[] = []
): RegradeResult {
  const cap = itinerary?.budgetCap?.amount ?? null;
  const currency: CurrencyCode = itinerary?.budgetCap?.currency || "CAD";
  const applicableComponents = componentReports.filter((c) => c.applicable);
  /* pricedItems / evidencedItems are ALL-IN scope counts since
   * 2026-10-22: plan items + applicable component lines. */
  const pricedItems = itemReports.length + applicableComponents.length;
  const evidencedItems = itemReports.filter(
    (r) => r.estimate.tier !== "UNKNOWN" || (r.real && !r.real.excludedFromTotals)
  );
  const evidencedComponents = applicableComponents.filter(
    (c) => c.estimate.tier !== "UNKNOWN" || c.real
  );
  const evidenced = [...evidencedItems, ...evidencedComponents];
  const coverage = pricedItems ? evidenced.length / pricedItems : 0;
  let low = 0, high = 0, realItems = 0, estimatedItems = 0;
  for (const r of evidencedItems) {
    if (r.real && !r.real.excludedFromTotals) {
      low += r.real.amountParty;
      high += r.real.amountParty;
      realItems += 1;
    } else if (r.estimate.partyRange) {
      low += r.estimate.partyRange.low;
      high += r.estimate.partyRange.high;
      estimatedItems += 1;
    }
  }
  for (const c of evidencedComponents) {
    if (c.real) {
      low += c.real.amountParty;
      high += c.real.amountParty;
      realItems += 1;
    } else if (c.estimate.partyRange) {
      low += c.estimate.partyRange.low;
      high += c.estimate.partyRange.high;
      estimatedItems += 1;
    }
  }
  const totals = { low, high, currency };
  let verdict: BudgetVerdict, verdictReason: string;
  if (cap == null) {
    verdict = "UNVERIFIABLE";
    verdictReason = "no budget cap was recorded for this trip";
  } else if (!pricedItems) {
    verdict = "UNVERIFIABLE";
    verdictReason = "the plan carries no priced items to re-grade";
  } else if (coverage <= COVERAGE_THRESHOLD) {
    verdict = "UNVERIFIABLE";
    verdictReason = `evidence covers ${evidenced.length} of ${pricedItems} all-in scope lines (${Math.round(coverage * 100)}%) — plan items + lodging + getting-there — not the stated majority (>${Math.round(COVERAGE_THRESHOLD * 100)}%) the verdict requires`;
  } else if (totals.high <= cap) {
    verdict = "WITHIN";
    verdictReason = `even the top of the re-graded range (${currency} ${totals.high}) sits under the cap (${currency} ${cap}) — ${realItems} item(s) priced by reality, ${estimatedItems} still estimated`;
  } else if (totals.low > cap) {
    verdict = "OVER";
    verdictReason = `real prices moved the floor: even the bottom of the re-graded range (${currency} ${totals.low}) exceeds the cap (${currency} ${cap}) — ${realItems} item(s) priced by reality, ${estimatedItems} still estimated`;
  } else {
    verdict = "AT RISK";
    verdictReason = `the re-graded range (${currency} ${totals.low}–${totals.high}) straddles the cap (${currency} ${cap}) — ${realItems} item(s) priced by reality, ${estimatedItems} still estimated`;
  }
  return {
    verdict,
    verdictReason,
    cap: cap == null ? null : { amount: cap, currency },
    totals,
    coverage: +coverage.toFixed(2),
    pricedItems,
    evidencedItems: evidenced.length,
    realItems,
    estimatedItems
  };
}

export interface Rollup {
  gradedItems: number;
  unverifiableItems: number;
  estimatedRange: { low: number; high: number };
  realTotal: number;
  variancePct: number | null;
  varianceBasis: string | null;
}

function rollup(reports: ItemReport[]): Rollup {
  // Graded = both numbers exist and the real one counts (not stale).
  const graded = reports.filter((r) => r.real && !r.real.excludedFromTotals && r.estimate.partyRange);
  const estLow = graded.reduce((s, r) => s + (r.estimate.partyRange?.low ?? 0), 0);
  const estHigh = graded.reduce((s, r) => s + (r.estimate.partyRange?.high ?? 0), 0);
  const realTotal = graded.reduce((s, r) => s + (r.real?.amountParty ?? 0), 0);
  const mid = (estLow + estHigh) / 2;
  return {
    gradedItems: graded.length,
    unverifiableItems: reports.filter((r) => r.verdict === "UNVERIFIABLE").length,
    estimatedRange: { low: estLow, high: estHigh },
    realTotal,
    variancePct: graded.length && mid ? round1(((realTotal - mid) / mid) * 100) : null,
    varianceBasis: graded.length
      ? "real total vs the midpoint of the estimated range, over graded items only; unverifiable items are excluded, never zeroed"
      : null
  };
}

/* ALL-IN trip rollup (2026-10-22): the trip rollup's MONEY fields —
 * graded count, estimated range, real total, variance — fold the
 * applicable component lines in, so the reckoning's headline real
 * total is the whole trip's money (paid stay + paid fare + graded
 * plan items). unverifiableItems keeps its contract meaning — PLAN
 * items without a verdict (the Phase 1 DTO carries items; component
 * lines carry their own verdicts on CheckpointReport.components). */
function rollupWithComponents(items: ItemReport[], components: ComponentReport[]): Rollup {
  const base = rollup(items);
  const graded = components.filter((c) => c.applicable && c.real && c.estimate.partyRange);
  if (!graded.length) return base;
  const estLow = base.estimatedRange.low + graded.reduce((s, c) => s + (c.estimate.partyRange?.low ?? 0), 0);
  const estHigh = base.estimatedRange.high + graded.reduce((s, c) => s + (c.estimate.partyRange?.high ?? 0), 0);
  const realTotal = base.realTotal + graded.reduce((s, c) => s + (c.real?.amountParty ?? 0), 0);
  const gradedCount = base.gradedItems + graded.length;
  const mid = (estLow + estHigh) / 2;
  return {
    gradedItems: gradedCount,
    unverifiableItems: base.unverifiableItems,
    estimatedRange: { low: estLow, high: estHigh },
    realTotal,
    variancePct: gradedCount && mid ? round1(((realTotal - mid) / mid) * 100) : null,
    varianceBasis:
      "real total vs the midpoint of the estimated range, over graded lines only (plan items + all-in lodging/getting-there components); unverifiable lines are excluded, never zeroed"
  };
}

/* ------------------------------------------------------------------ */
/* One checkpoint run. Checkpoint gates which sources may speak:       */
/*   BEFORE  library + live checks only (nothing is booked yet)        */
/*   DURING  + booking confirmations (PAID enters, trust #1)           */
/*   AFTER   + post-trip actuals (the reckoning)                       */
/* ------------------------------------------------------------------ */

export interface LoudFlag {
  type: "BUDGET_BUSTED_BY_REAL_PRICES";
  message: string;
  law: string;
}

export interface BiasObservation {
  key: string | null;
  category: PricedCategory;
  tier: PriceTierName;
  modeledRange: { low: number; high: number; currency: CurrencyCode };
  realPerPerson: number;
}

export interface CheckpointReport {
  checkpoint: BudgetCheckpoint;
  at: string | null;
  tripRef: string | null;
  items: ItemReport[];
  /** ALL-IN scope lines (lodging + getting-there) with their evidence
   *  and reals — named even when unevidenced, never silently absent. */
  components: ComponentReport[];
  rollups: { trip: Rollup; byCategory: Record<string, Rollup> };
  regrade: RegradeResult;
  loud: LoudFlag[];
  observations: BiasObservation[];
}

export function runCheckpoint(
  itinerary: BvrItinerary,
  checkpoint: BudgetCheckpoint,
  ctx: CheckpointContext = {}
): CheckpointReport {
  if (!["BEFORE", "DURING", "AFTER"].includes(checkpoint))
    throw new Error(`unknown checkpoint ${checkpoint}`);
  const payingParty = payingPartyOf(itinerary.travelers || { adults: 2, children: 0, infants: 0 });
  const paidFacts: PaidFact[] = [];
  if (checkpoint !== "BEFORE") {
    for (const f of ctx.bookingFacts || []) paidFacts.push({ ...f, actual: false });
    if (checkpoint === "AFTER")
      for (const a of ctx.actuals || [])
        paidFacts.push({
          ...a,
          actual: true,
          price: { amount: a.amount, currency: a.currency || "CAD", status: "paid-actual" }
        });
  }
  /* ALL-IN: component-marked facts (paid flight / paid stay) grade as
   * scope components, never as plan items — the two pools are disjoint
   * by construction, so no fact can be counted twice. */
  const itemFacts = paidFacts.filter((f) => !f.component);
  const componentFacts = paidFacts.filter(
    (f) => f.component === "lodging" || f.component === "transport"
  );
  const effCtx: ResolveContext & { outcomes?: Record<string, string> } = {
    now: ctx.now,
    library: ctx.library || null,
    liveChecks: checkpoint === "BEFORE" || checkpoint === "DURING" ? ctx.liveChecks || [] : [],
    outcomes: ctx.outcomes || {},
    paidFacts: itemFacts
  };
  const items: ItemReport[] = [];
  for (const day of itinerary.days || []) {
    for (const item of day.items || []) {
      const r = gradeItem(item, day.dayNumber, effCtx, payingParty);
      if (r) items.push(r);
    }
  }
  const components: ComponentReport[] = (["lodging", "transport"] as const).map((c) =>
    gradeComponent(c, itinerary, componentFacts.filter((f) => f.component === c))
  );
  const regrade = regradeBudget(itinerary, items, components);
  const loud: LoudFlag[] = [];
  if (regrade.verdict === "OVER") {
    loud.push({
      type: "BUDGET_BUSTED_BY_REAL_PRICES",
      message: `Real prices have busted this trip's budget: ${regrade.verdictReason}`,
      law: "Build 2 addition A — silent for alignment, LOUD for costly collisions. This is never absorbed silently."
    });
  }
  const byCategory: Record<string, ItemReport[]> = {};
  for (const r of items) (byCategory[r.category] ||= []).push(r);
  const rollups = {
    trip: rollupWithComponents(items, components),
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([c, rs]) => [c, rollup(rs)]))
  };
  // Bias observations: graded items whose estimate came from a BAND
  // or a COSTED model — the two estimate kinds that can drift from
  // reality.
  const observations: BiasObservation[] = items
    .filter(
      (r) =>
        r.real && !r.real.excludedFromTotals && ["BAND", "COSTED"].includes(r.estimate.tier) && r.estimate.rangePerPerson
    )
    .map((r) => ({
      key: r.key,
      category: r.category,
      tier: r.estimate.tier,
      modeledRange: r.estimate.rangePerPerson as { low: number; high: number; currency: CurrencyCode },
      realPerPerson: (r.real?.amountParty ?? 0) / payingParty
    }));
  return { checkpoint, at: ctx.now || null, tripRef: itinerary.tripRef || null, items, components, rollups, regrade, loud, observations };
}

/* ------------------------------------------------------------------ */
/* Calibration — confirmed real prices flow back into the library in   */
/* the ladder's VERIFIED shape, so the next plan is graded against     */
/* reality. PAID only: a live check is an observation, not a confirmed  */
/* price, and never calibrates.                                        */
/* ------------------------------------------------------------------ */

export function calibrate(
  itemReports: ItemReport[],
  store: LibraryStore,
  opts: { now: string }
): (LibraryRecord & { key: string })[] {
  const written: (LibraryRecord & { key: string })[] = [];
  for (const r of itemReports) {
    if (!r.real || r.real.source !== "PAID" || !r.key) continue;
    const rec = store.upsertConfirmed(r.key, {
      amount: r.real.amountParty,
      currency: r.real.currency,
      per: "party", // booking confirmations and actuals state party totals
      source: r.real.basis,
      recordedAt: dateOf(opts.now)
    });
    written.push({ key: r.key, ...rec });
  }
  return written;
}

/* ------------------------------------------------------------------ */
/* Bias proposals — accumulated observations accuse a band/model of a  */
/* systematic miss. A proposal is a RECORD FOR REVIEW. It changes      */
/* nothing: no range is edited, no model is tuned, until the owner     */
/* rules on it.                                                        */
/* ------------------------------------------------------------------ */

export interface BiasProposal {
  category: PricedCategory;
  tier: PriceTierName;
  observations: number;
  medianRealPerPerson: number;
  modeledRange: { low: number; high: number };
  direction: string;
  status: string;
}

export function proposeBias(
  observations: BiasObservation[],
  opts: { minObservations?: number } = {}
): BiasProposal[] {
  const { minObservations = BIAS_MIN_OBSERVATIONS } = opts;
  const groups = new Map<string, { category: PricedCategory; tier: PriceTierName; reals: number[]; lows: number[]; highs: number[] }>();
  for (const o of observations || []) {
    const gk = `${o.category}|${o.tier}`;
    if (!groups.has(gk)) groups.set(gk, { category: o.category, tier: o.tier, reals: [], lows: [], highs: [] });
    const g = groups.get(gk);
    if (!g) continue;
    g.reals.push(o.realPerPerson);
    g.lows.push(o.modeledRange.low);
    g.highs.push(o.modeledRange.high);
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const proposals: BiasProposal[] = [];
  for (const g of groups.values()) {
    if (g.reals.length < minObservations) continue;
    const medianReal = median(g.reals);
    const modeledRange = { low: median(g.lows), high: median(g.highs) };
    let direction: string | null = null;
    if (medianReal > modeledRange.high) direction = "estimates run LOW — real prices land above the modeled range";
    else if (medianReal < modeledRange.low) direction = "estimates run HIGH — real prices land below the modeled range";
    if (!direction) continue;
    proposals.push({
      category: g.category,
      tier: g.tier,
      observations: g.reals.length,
      medianRealPerPerson: medianReal,
      modeledRange,
      direction,
      status: "PROPOSED — recorded for owner review; never applied silently"
    });
  }
  return proposals;
}
