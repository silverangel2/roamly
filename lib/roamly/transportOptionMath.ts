/**
 * Stage 8 (2026-11-11) — gazetteer eviction: the pure transport-option math + label helpers, moved verbatim from transportOptions.ts (optionAverage, transportOptionCostCents) and priceDiscovery.ts (transportConfidenceLabel, transportRangeLabel, moneyFromCents). transportOptions + priceDiscovery re-export / import them back.
 *
 * This module is deliberately DATA-FREE: it must never import
 * placeResolver / airportResolver / bookingLinks / affiliateResolver
 * (directly or transitively), so client components may import it
 * without dragging the geonames + IATA data chunks into the page's
 * initial load. The functions here were moved verbatim from their
 * original homes (named in each section) — behaviour is unchanged;
 * the original modules re-export them for their existing importers.
 */

import type { TransportOption } from "@/lib/roamly/transportOptions";
import type { BudgetCategoryConfidenceLabel } from "@/lib/roamly/priceDiscovery";

export function optionAverage(option: Pick<TransportOption, "estimated_cost_min" | "estimated_cost_max">) {
  if (option.estimated_cost_min != null && option.estimated_cost_max != null) {
    return (option.estimated_cost_min + option.estimated_cost_max) / 2;
  }
  return option.estimated_cost_min ?? option.estimated_cost_max ?? null;
}

export function transportOptionCostCents(option: TransportOption | null | undefined) {
  const amount = option ? optionAverage(option) : null;
  return amount == null ? null : Math.max(0, Math.round(amount * 100));
}

export function transportConfidenceLabel(transport: TransportOption | null | undefined): BudgetCategoryConfidenceLabel {
  return transport?.price_confidence === "live_partner"
    ? "Live price"
    : transport?.price_confidence === "cached_recent"
      ? "Recently searched"
      : transport?.availability === "search_ready"
        ? "Market estimate"
        : "Conservative estimate";
}

export function moneyFromCents(value: number, currency = "CAD") {
  return `${currency.toUpperCase()} ${Math.round(value / 100).toLocaleString("en-CA")}`;
}

export function transportRangeLabel(option: TransportOption | null | undefined, currency: string) {
  if (!option) return "No recommended transport option selected.";
  const min = option.estimated_cost_min == null ? null : moneyFromCents(option.estimated_cost_min * 100, currency);
  const max = option.estimated_cost_max == null ? null : moneyFromCents(option.estimated_cost_max * 100, currency);
  const range = min && max ? `${min}-${max}` : min || max || "price unknown";
  return `${option.title}: ${range} (${option.availability}, ${option.realistic ? "realistic" : "not recommended"}, ${option.price_confidence}). ${option.why_recommended} ${option.warning}`;
}

