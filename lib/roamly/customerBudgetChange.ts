import type { RoamlyItinerary } from "@/lib/itinerary";
import { getItineraryTotalEstimateAmount } from "@/lib/itinerary";
import { calculateBudgetStatus } from "@/lib/roamly/priceDiscovery";
import { findCustomerRemovalTarget } from "@/lib/roamly/itineraryRepair";

export type BudgetChangeFlexibleItem = {
  dayId: string;
  itemId: string;
  title: string;
  estimatedCost: number | null;
  candidateId: string | null;
  nextAction: "remove_or_replace";
};

export type BudgetChangePreview = {
  currentBudgetAmount: number | null;
  requestedBudgetAmount: number;
  currency: string;
  totalEstimateAmount: number | null;
  committedAmount: number | null;
  committedStatus: string;
  remainingBudgetAmount: number | null;
  budgetStatus: "within_budget" | "tight" | "over_budget" | "unknown";
  uncertainty: string[];
  flexibleItems: BudgetChangeFlexibleItem[];
  resultingBreakdown: Record<string, unknown>;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function staleEvidence(itinerary: RoamlyItinerary, priceDiscovery: Record<string, unknown> | null) {
  const now = Date.now();
  const expiredSuggestion = itinerary.booking_suggestions.some((suggestion) => {
    const expiresAt = typeof suggestion.expires_at === "string" ? Date.parse(suggestion.expires_at) : NaN;
    return Number.isFinite(expiresAt) && expiresAt <= now;
  });
  const marketResults = Array.isArray(priceDiscovery?.marketResults) ? priceDiscovery.marketResults : [];
  const expiredMarket = marketResults.some((result) => {
    if (!result || typeof result !== "object") return false;
    const expiresAt = (result as Record<string, unknown>).expires_at;
    const parsed = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
    return Number.isFinite(parsed) && parsed <= now;
  });
  return expiredSuggestion || expiredMarket;
}

export function buildBudgetChangePreview(params: {
  itinerary: RoamlyItinerary;
  currentBudgetAmount: number | null;
  requestedBudgetAmount: number;
  currency: string;
  committedAmount: number | null;
  committedStatus: string;
  priceDiscovery: Record<string, unknown> | null;
}) : BudgetChangePreview {
  const totalEstimateAmount = getItineraryTotalEstimateAmount(params.itinerary);
  const totalEstimateCents = totalEstimateAmount == null ? 0 : Math.round(totalEstimateAmount * 100);
  const committedStatus = params.committedStatus || "unknown_amount";
  const calculation = totalEstimateAmount == null
    ? { budgetStatus: "unknown" as const, remainingBudgetCents: null }
    : calculateBudgetStatus({
        budgetAmount: params.requestedBudgetAmount,
        budgetCurrency: params.currency,
        totalEstimateCents,
        committedBudgetCents: params.committedAmount == null ? null : Math.round(params.committedAmount * 100),
        committedBookingStatus: committedStatus as never
      });
  const uncertainty = Array.isArray(params.priceDiscovery?.unknownMarketPriceCategories)
    ? params.priceDiscovery.unknownMarketPriceCategories.filter((item): item is string => typeof item === "string")
    : [];
  if (!params.priceDiscovery) uncertainty.push("Current price evidence is unavailable.");
  if (committedStatus !== "known_compatible") uncertainty.push("Confirmed booking costs are not fully comparable in this currency.");
  if (staleEvidence(params.itinerary, params.priceDiscovery)) uncertainty.push("Some saved price or booking evidence needs a fresh check.");
  if (totalEstimateAmount == null) uncertainty.push("The current itinerary does not have a complete estimate.");
  const budgetStatus = staleEvidence(params.itinerary, params.priceDiscovery) || committedStatus !== "known_compatible" || uncertainty.length > 0
    ? "unknown"
    : calculation.budgetStatus;
  const remainingBudgetAmount = budgetStatus === "unknown" || calculation.remainingBudgetCents == null ? null : calculation.remainingBudgetCents / 100;
  const resultingBreakdown: Record<string, unknown> = {
    ...(params.itinerary.estimated_budget_breakdown as unknown as Record<string, unknown>),
    user_budget_amount: params.requestedBudgetAmount,
    currency: params.currency,
    remaining_budget_amount: remainingBudgetAmount,
    budget_status: budgetStatus
  };
  const flexibleItems: BudgetChangeFlexibleItem[] = [];
  for (const day of params.itinerary.daily_itinerary) {
    if (!day.day_id) continue;
    for (const item of day.live_timeline) {
      if (!item.item_id) continue;
      const target = findCustomerRemovalTarget(params.itinerary, day.day_id, item.item_id);
      if (!target.ok) continue;
      const estimatedCost = finiteNumber(item.estimated_cost);
      if (estimatedCost == null || estimatedCost <= 0) continue;
      flexibleItems.push({
        dayId: day.day_id,
        itemId: item.item_id,
        title: item.title,
        estimatedCost,
        candidateId: typeof item.candidateId === "string" ? item.candidateId : null,
        nextAction: "remove_or_replace"
      });
    }
  }
  return {
    currentBudgetAmount: params.currentBudgetAmount,
    requestedBudgetAmount: params.requestedBudgetAmount,
    currency: params.currency,
    totalEstimateAmount,
    committedAmount: params.committedAmount,
    committedStatus,
    remainingBudgetAmount,
    budgetStatus,
    uncertainty: Array.from(new Set(uncertainty)).slice(0, 6),
    flexibleItems: flexibleItems.sort((a, b) => (b.estimatedCost || 0) - (a.estimatedCost || 0)).slice(0, 8),
    resultingBreakdown
  };
}

export function applyBudgetChangeToItinerary(itinerary: RoamlyItinerary, preview: BudgetChangePreview) {
  return {
    ...itinerary,
    estimated_budget_breakdown: preview.resultingBreakdown as RoamlyItinerary["estimated_budget_breakdown"],
    budget_fit_summary: preview.budgetStatus === "over_budget"
      ? `The current estimate is above your ${preview.currency} ${preview.requestedBudgetAmount.toLocaleString("en-CA")} budget. Confirmed commitments stay protected; flexible choices can be reconsidered.`
      : preview.budgetStatus === "unknown"
        ? "Budget remains uncertain until missing prices and confirmed booking amounts are verified."
        : `The current estimate is within the ${preview.currency} ${preview.requestedBudgetAmount.toLocaleString("en-CA")} budget.`,
  };
}
