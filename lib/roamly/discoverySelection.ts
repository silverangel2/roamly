/**
 * Stage 8 (2026-11-11) — gazetteer eviction: the traveller-selection re-tabulation + the budget-constraint text builder, moved verbatim from priceDiscovery.ts. TripPlanForm (the /plan client graph) imports these two functions from here; priceDiscovery re-exports them for its server-side importers.
 *
 * This module is deliberately DATA-FREE: it must never import
 * placeResolver / airportResolver / bookingLinks / affiliateResolver
 * (directly or transitively), so client components may import it
 * without dragging the geonames + IATA data chunks into the page's
 * initial load. The functions here were moved verbatim from their
 * original homes (named in each section) — behaviour is unchanged;
 * the original modules re-export them for their existing importers.
 */

import { calculateBudgetStatus } from "@/lib/roamly/budgetStatus";
import {
  transportConfidenceLabel,
  transportOptionCostCents,
  transportRangeLabel
} from "@/lib/roamly/transportOptionMath";
import type { TripPriceDiscovery } from "@/lib/roamly/priceDiscovery";
import type { TransportOption } from "@/lib/roamly/transportOptions";

/**
 * The traveller's confirmed pick from the transport selector, applied
 * to a completed discovery. Pure re-tabulation with the discovery's
 * own formula: transport cents come from the picked option (the same
 * transportOptionCostCents the engine used), fixed costs are whatever
 * the rest of the trip already totalled, buffer stays 12%, and budget
 * status is recomputed with the same calculateBudgetStatus the engine
 * used — so the trip's auto-calculation can never drift from the
 * engine's math. The pick is stamped as transportSelection so it is
 * never confused with the logic map's recommendation downstream.
 *
 * Guard rails: an option the logic map excluded by rule (or one with
 * no service on the route) can never be applied — the discovery is
 * returned unchanged. The map shortlists; the traveller confirms;
 * neither can resurrect an excluded mode.
 */
export function applyTransportOptionSelection(discovery: TripPriceDiscovery, option: TransportOption): TripPriceDiscovery {
  if (!option || option.availability === "not_available" || option.presentation === "excluded") return discovery;
  const sameOption = (candidate: TransportOption) => candidate.mode === option.mode && candidate.title === option.title;
  if (!discovery.transportOptions.some(sameOption)) return discovery;

  const selectedTransportEstimateCents =
    discovery.budgetIncludesFlights === false ? 0 : transportOptionCostCents(option) || discovery.flightEstimateCents;
  const fixedTripCostCents = discovery.totalEstimateCents - discovery.bufferEstimateCents - discovery.selectedTransportEstimateCents;
  const subtotalCents = selectedTransportEstimateCents + fixedTripCostCents;
  const bufferEstimateCents = Math.round(subtotalCents * 0.12);
  const totalEstimateCents = subtotalCents + bufferEstimateCents;
  const budget = calculateBudgetStatus({
    budgetAmount: discovery.budgetAmount,
    budgetCurrency: discovery.budgetCurrency,
    totalEstimateCents,
    committedBudgetCents: discovery.committedBudgetCents,
    committedBookingStatus: discovery.committedBookingCostStatus
  });

  const transportOptions = discovery.transportOptions.map((candidate) => {
    if (sameOption(candidate)) {
      return {
        ...candidate,
        budget_fit: "best" as TransportOption["budget_fit"],
        presentation: "suggested" as const,
        presentation_label: "Your pick — added to your itinerary and budget",
        logic_rule: candidate.logic_rule ?? null
      };
    }
    return candidate.budget_fit === "best"
      ? { ...candidate, budget_fit: "okay" as TransportOption["budget_fit"], presentation: "available" as const, presentation_label: null }
      : candidate;
  });

  const budgetCategoryConfidence = discovery.budgetCategoryConfidence.map((entry) =>
    entry.category === "transport"
      ? {
          ...entry,
          label: transportConfidenceLabel(option),
          amountCents: selectedTransportEstimateCents,
          source: option.source || entry.source,
          note: option.warning || entry.note
        }
      : entry
  );

  return {
    ...discovery,
    transportOptions,
    recommendedTransportOption: option,
    transportSelection: { mode: option.mode, title: option.title, selectedBy: "traveler" },
    selectedTransportEstimateCents,
    bufferEstimateCents,
    totalEstimateCents,
    remainingBudgetCents: budget.remainingBudgetCents,
    budgetStatus: budget.budgetStatus,
    budgetCategoryConfidence
  };
}

export function buildBudgetConstraintForItinerary(discovery: TripPriceDiscovery) {
  const transportComparison = [
    `${discovery.transportSelection ? "Traveller-selected transport" : "Recommended transport"}: ${transportRangeLabel(discovery.recommendedTransportOption, discovery.budgetCurrency)}`,
    `Transport options: ${discovery.transportOptions.map((option) => transportRangeLabel(option, discovery.budgetCurrency)).join(" | ") || "none"}.`,
    "Before finalizing the itinerary, compare flight, driving, train, bus, and mixed transport modes by route availability, travel time, budget fit, comfort, and time saved.",
    "Do not recommend bus/train as best unless the option is verified or search-ready, realistic, and reasonable for the trip length.",
    "If the budget is tight, prefer realistic cheaper options and explain tradeoffs with the phrases: \"Recommended because it keeps the trip closer to your budget\" or \"Faster but more expensive\" as appropriate."
  ].join(" ");
  const marketNote = [
    `Price coverage: ${discovery.priceCoverage}.`,
    "Full budget estimate generated using best available price sources. Some items use conservative market estimates and should be refreshed before booking.",
    `Budget confidence: ${discovery.budgetCategoryConfidence.map((item) => `${item.category}: ${item.label} (${item.note})`).join(" | ")}.`,
    discovery.cross_border ? `Cross-border trip: true. ${discovery.crossBorderWarnings.join(" ")}` : "Cross-border trip: false.",
    "Use selectedMarketPrices and transportOptions for booking recommendation prices. Never invent exact live prices.",
    transportComparison
  ].join(" ");
  if (discovery.budgetStatus === "over_budget") {
    return [
      "The trip may exceed budget. Build a budget-first itinerary with free or low-cost activities, public transit, affordable food, and clear warnings about expensive choices.",
      "Suggest cheaper city order, shorter trip length, fewer paid activities, lower-cost hotel areas, public transit, excluding flights/hotel if already handled, or increasing budget where needed.",
      `Selected total: ${discovery.budgetCurrency} ${Math.round(discovery.totalEstimateCents / 100)}. Uploaded/saved booking costs: ${discovery.committedBudgetCents == null ? "unresolved" : `${discovery.budgetCurrency} ${Math.round(discovery.committedBudgetCents / 100)}`}.`,
      marketNote
    ].join(" ");
  }
  if (discovery.budgetStatus === "tight") {
    return `The budget is tight. Prioritize affordable stays, free attractions, public transit, and low-cost food while keeping the trip enjoyable. Selected total: ${discovery.budgetCurrency} ${Math.round(discovery.totalEstimateCents / 100)}. ${marketNote}`;
  }
  if (discovery.budgetStatus === "unknown") {
    return `No total budget was provided. Keep prices transparent, separate free and paid activities, and remind the traveler to verify costs before booking. ${marketNote}`;
  }
  return `The trip appears possible within budget. Keep the itinerary practical and include price verification reminders. ${marketNote}`;
}

