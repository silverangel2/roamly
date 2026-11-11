/**
 * Stage 8 (2026-11-11) — gazetteer eviction: the budget-status math, moved verbatim from priceDiscovery.ts. stayOptions (client graph via StaySelector) needs calculateBudgetStatus; priceDiscovery re-exports it.
 *
 * This module is deliberately DATA-FREE: it must never import
 * placeResolver / airportResolver / bookingLinks / affiliateResolver
 * (directly or transitively), so client components may import it
 * without dragging the geonames + IATA data chunks into the page's
 * initial load. The functions here were moved verbatim from their
 * original homes (named in each section) — behaviour is unchanged;
 * the original modules re-export them for their existing importers.
 */

import type { ConfirmedBookingCostStatus } from "@/lib/roamly/bookings";

export type BudgetStatus = "within_budget" | "tight" | "over_budget" | "unknown";

function cents(amount: number) {
  return Math.max(0, Math.round(amount * 100));
}

export function calculateBudgetStatus(input: {
  budgetAmount: number | null;
  budgetCurrency: string;
  totalEstimateCents: number;
  committedBudgetCents?: number | null;
  committedBookingStatus?: ConfirmedBookingCostStatus;
}) {
  if (!input.budgetAmount) {
    return { budgetStatus: "unknown" as BudgetStatus, remainingBudgetCents: null };
  }
  if (input.committedBookingStatus && input.committedBookingStatus !== "known_compatible") {
    return { budgetStatus: "unknown" as BudgetStatus, remainingBudgetCents: null };
  }
  const budgetCents = cents(input.budgetAmount);
  const remainingBudgetCents = budgetCents - input.totalEstimateCents;
  const usedRatio = budgetCents ? input.totalEstimateCents / budgetCents : 0;
  const budgetStatus: BudgetStatus =
    remainingBudgetCents < 0 ? "over_budget" : usedRatio >= 0.86 ? "tight" : "within_budget";
  return { budgetStatus, remainingBudgetCents };
}

