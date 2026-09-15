import { formatBudgetMoney } from "@/lib/roamly/budget";
import type { BudgetBreakdown } from "@/lib/itinerary";

export type BudgetPresentationStatus = "WITHIN_BUDGET" | "LIKELY_WITHIN_BUDGET" | "OVER_BUDGET" | "BUDGET_UNCERTAIN";
export type BudgetCostStatus = "committed" | "expected" | "unknown";

export type BudgetPresentation = {
  status: BudgetPresentationStatus;
  statusLabel: string;
  statusDetail: string;
  targetLabel: string;
  totalLabel: string;
  remainingLabel: string | null;
  costDrivers: Array<{ label: string; value: string; status: BudgetCostStatus }>;
  uncertainty: string[];
  committedCount: number;
};

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unknownCopy(value: unknown, count: number) {
  const categories = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase()) : [];
  const result = new Set<string>();
  for (const category of categories) {
    if (/hotel|stay|lodging/.test(category)) result.add("Hotel price isn’t confirmed yet.");
    else if (/local|movement|transit/.test(category)) result.add("Local transportation isn’t priced yet.");
    else if (/flight|transport|getting there/.test(category)) result.add("Getting-there costs aren’t fully priced yet.");
    else if (/activity|ticket|tour/.test(category)) result.add("Some activity costs aren’t priced yet.");
    else if (/food|buffer|other/.test(category)) result.add("Some other trip costs aren’t priced yet.");
  }
  if (!result.size && count > 0) result.add("Some material trip costs aren’t priced yet.");
  return Array.from(result).slice(0, 3);
}

export function buildBudgetPresentation(input: {
  budgetAmount: number | null;
  currency: string;
  totalEstimateAmount: number | null;
  breakdown: BudgetBreakdown;
  priceDiscovery?: Record<string, unknown> | null;
  confirmedBookingCount?: number;
}): BudgetPresentation {
  const discovery = input.priceDiscovery || {};
  const unknownCount = numberValue(discovery.unknownMarketPriceCount) || 0;
  const uncertainty = unknownCopy(discovery.unknownMarketPriceCategories, unknownCount);
  const uncertain = input.totalEstimateAmount == null || unknownCount > 0 || input.breakdown.budget_status === "unknown";
  const status: BudgetPresentationStatus = input.breakdown.budget_status === "over_budget"
    ? "OVER_BUDGET"
    : input.budgetAmount == null || uncertain
      ? "BUDGET_UNCERTAIN"
      : input.breakdown.budget_status === "tight"
        ? "LIKELY_WITHIN_BUDGET"
        : "WITHIN_BUDGET";
  const statusLabel = status === "WITHIN_BUDGET" ? "Within budget" : status === "LIKELY_WITHIN_BUDGET" ? "Likely within budget" : status === "OVER_BUDGET" ? "Over budget" : "Budget still uncertain";
  const statusDetail = status === "WITHIN_BUDGET"
    ? "The current estimate fits your budget, based on the prices Roamly has."
    : status === "LIKELY_WITHIN_BUDGET"
      ? "The current estimate is close to your budget, so leave room for prices to move."
      : status === "OVER_BUDGET"
        ? "The current estimate is above your budget. Confirmed commitments stay protected; only flexible choices can be reconsidered."
        : input.budgetAmount == null
          ? "Add a budget target to understand affordability."
          : "Roamly is still missing material prices, so a remaining amount would be misleading.";
  const remaining = input.budgetAmount != null && input.totalEstimateAmount != null && status !== "BUDGET_UNCERTAIN"
    ? input.budgetAmount - input.totalEstimateAmount
    : null;
  const remainingLabel = remaining == null ? null : remaining < 0 ? `Over budget by ${formatBudgetMoney(Math.abs(remaining), input.currency)}` : `Remaining: ${formatBudgetMoney(remaining, input.currency)}`;
  const confidence = input.breakdown.budget_category_confidence || [];
  const foodAmount = numberValue(input.breakdown.food_estimate_amount);
  const bufferAmount = numberValue(input.breakdown.buffer_estimate_amount);
  const otherAmount = foodAmount != null && bufferAmount != null ? foodAmount + bufferAmount : null;
  const driver = (label: string, amount: number | null | undefined, category: string, unknownPattern: RegExp) => {
    if (typeof amount === "number" && Number.isFinite(amount)) return { label, value: formatBudgetMoney(amount, input.currency), status: "expected" as const };
    if (uncertainty.some((item) => unknownPattern.test(item))) return { label, value: "Not priced yet", status: "unknown" as const };
    if (confidence.some((item) => item.category === category && item.label === "User uploaded confirmation")) return { label, value: "Handled", status: "committed" as const };
    return null;
  };
  const costDrivers = [
    driver("Getting there", input.breakdown.selected_transport_estimate_amount, "transport", /getting-there/),
    driver("Stay", input.breakdown.selected_hotel_estimate_amount, "hotel", /hotel/),
    driver("Things to do", input.breakdown.tickets_tours_estimate_amount, "tickets_tours", /activity/),
    driver("Getting around", input.breakdown.local_transport_estimate_amount, "local_transport", /local/),
    driver("Other trip costs", otherAmount, "food", /other trip costs/)
  ].filter((item): item is { label: string; value: string; status: BudgetCostStatus } => Boolean(item));
  const committedCount = input.confirmedBookingCount || 0;
  if (committedCount > 0) costDrivers.unshift({ label: "Already committed", value: input.breakdown.committed_bookings_amount != null ? formatBudgetMoney(input.breakdown.committed_bookings_amount, input.currency) : "Amount not available", status: input.breakdown.committed_bookings_amount != null ? "committed" : "unknown" });
  return {
    status,
    statusLabel,
    statusDetail,
    targetLabel: input.budgetAmount == null ? "Budget target not set" : formatBudgetMoney(input.budgetAmount, input.currency),
    totalLabel: input.totalEstimateAmount == null ? "Not calculated" : formatBudgetMoney(input.totalEstimateAmount, input.currency),
    remainingLabel,
    costDrivers: costDrivers.slice(0, 6),
    uncertainty,
    committedCount
  };
}
