/**
 * Stay options + selection for the detailed itinerary (owner order,
 * 2026-11-08: "your detailed IT does not use BoardUI or even a
 * selector for hotel"). The mirror of the transport selector's
 * pattern (lib/roamly/transportOptions.ts + applyTransportOptionSelection):
 * the stored trip already carries its stay options — the curated
 * hotel booking suggestions (at most three) — and the traveller's
 * pick re-tabulates the trip's stay line and total with the engine's
 * own formula, stamped as a selection so it is never confused with
 * the engine's estimate.
 *
 * Price honesty (the stay surface's own standing rule, the same one
 * hotelTravelerPrice enforces on the trip page): a suggestion may
 * show a price only when its stored price is a live-partner or
 * recently-searched price with a usable amount and a confidence
 * other than "unknown". Estimate-only numbers attached to a named
 * property are never displayed as that property's price, and a stay
 * without a displayable price is never a selectable card — it
 * renders as one quiet line. A range costs its midpoint in the
 * re-tabulation, the same optionAverage rule transport uses.
 */
import type { RoamlyBookingSuggestion } from "@/lib/itinerary";
import {
  calculateBudgetStatus,
  type BudgetCategoryConfidenceLabel,
  type TripPriceDiscovery
} from "@/lib/roamly/priceDiscovery";

export type StaySelection = {
  candidateId: string | null;
  title: string;
  selectedBy: "traveler";
};

export type StayOption = {
  /** Stable identity: the suggestion's candidateId, else its title. */
  id: string;
  title: string;
  /** Stored area words (neighbourhood, else location, else city). */
  area: string | null;
  roomType: string | null;
  /** First stored photo for the property; null when none is stored. */
  photoUrl: string | null;
  nights: number;
  /** Whole-stay price range in dollars, when displayable. The total
   *  is the stored total range, or the stored nightly range × nights
   *  when only nightly figures were stored (the engine's own
   *  derivation — nightly × nights — never an invented figure). */
  totalMin: number | null;
  totalMax: number | null;
  /** Per-night range in dollars, only when nightly figures are stored. */
  nightlyMin: number | null;
  nightlyMax: number | null;
  currency: string;
  /** Where a displayable price came from; null when there is none. */
  priceType: "live_partner" | "cached_recent" | null;
  /** The provider/source words the suggestion itself carries. */
  source: string | null;
  /** The top-ranked selectable option — the suggested pick. */
  suggested: boolean;
};

function positiveAmount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function cleanText(value: string | null | undefined): string | null {
  const text = (value || "").trim();
  return text ? text : null;
}

/**
 * The stay surface's price-display rule (identical conditions to the
 * trip page's hotelTravelerPrice): live-partner or cached price,
 * confidence not "unknown", and at least one usable amount stored.
 */
export function stayPriceDisplayable(suggestion: RoamlyBookingSuggestion): boolean {
  const live = suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent";
  if (!live || suggestion.price_confidence === "unknown") return false;
  return Boolean(
    positiveAmount(suggestion.estimated_total_cost_min ?? suggestion.estimated_cost_min) ||
      positiveAmount(suggestion.estimated_total_cost_max ?? suggestion.estimated_cost_max) ||
      positiveAmount(suggestion.estimated_nightly_cost_min) ||
      positiveAmount(suggestion.estimated_nightly_cost_max)
  );
}

export function buildStayOptions(suggestions: RoamlyBookingSuggestion[], nights: number): StayOption[] {
  const safeNights = Math.max(1, Math.round(Number.isFinite(nights) && nights > 0 ? nights : 1));
  const options = suggestions
    .filter((suggestion) => (suggestion.category || suggestion.booking_category) === "hotel")
    .map((suggestion): StayOption => {
      const displayable = stayPriceDisplayable(suggestion);
      let totalMin: number | null = null;
      let totalMax: number | null = null;
      let nightlyMin: number | null = null;
      let nightlyMax: number | null = null;
      if (displayable) {
        nightlyMin = positiveAmount(suggestion.estimated_nightly_cost_min);
        nightlyMax = positiveAmount(suggestion.estimated_nightly_cost_max);
        totalMin = positiveAmount(suggestion.estimated_total_cost_min ?? suggestion.estimated_cost_min);
        totalMax = positiveAmount(suggestion.estimated_total_cost_max ?? suggestion.estimated_cost_max);
        if (totalMin == null && totalMax == null && (nightlyMin != null || nightlyMax != null)) {
          // Only nightly figures stored: the whole-stay range is the
          // engine's own derivation (nightly × nights).
          totalMin = nightlyMin == null ? null : nightlyMin * safeNights;
          totalMax = nightlyMax == null ? null : nightlyMax * safeNights;
        }
      }
      const photoUrl =
        Array.isArray(suggestion.photo_urls) && typeof suggestion.photo_urls[0] === "string" && suggestion.photo_urls[0].trim()
          ? suggestion.photo_urls[0]
          : null;
      return {
        id: cleanText(suggestion.candidateId) || suggestion.title,
        title: suggestion.title,
        area: cleanText(suggestion.neighborhood) || cleanText(suggestion.location) || cleanText(suggestion.city),
        roomType: cleanText(suggestion.room_type),
        photoUrl,
        nights: safeNights,
        totalMin,
        totalMax,
        nightlyMin,
        nightlyMax,
        currency: suggestion.currency || "CAD",
        priceType: displayable
          ? suggestion.price_type === "live_partner"
            ? "live_partner"
            : "cached_recent"
          : null,
        source: cleanText(suggestion.provider_or_search_source) || cleanText(suggestion.provider),
        suggested: false
      };
    });
  const firstSelectable = options.findIndex((option) => stayOptionCostCents(option) != null);
  if (firstSelectable >= 0) options[firstSelectable].suggested = true;
  return options;
}

/** A range costs its midpoint — the same rule transport uses
 *  (optionAverage in transportOptions.ts). Null when the option
 *  carries no displayable whole-stay price. */
export function stayOptionCostCents(option: StayOption | null | undefined): number | null {
  if (!option) return null;
  const average =
    option.totalMin != null && option.totalMax != null
      ? (option.totalMin + option.totalMax) / 2
      : option.totalMin ?? option.totalMax ?? null;
  return average == null ? null : Math.max(0, Math.round(average * 100));
}

/**
 * The re-tabulation core, shared by the discovery-level selection
 * below and the detail surface (whose totals live in the itinerary's
 * budget breakdown): fixed costs are whatever the rest of the trip
 * already totalled, the buffer stays 12%, so a stay pick can never
 * drift from the engine's math.
 */
export function retabulateStayTotals(
  current: { totalEstimateCents: number; bufferEstimateCents: number; stayEstimateCents: number },
  newStayCents: number
): { stayEstimateCents: number; bufferEstimateCents: number; totalEstimateCents: number } {
  const fixedTripCostCents = current.totalEstimateCents - current.bufferEstimateCents - current.stayEstimateCents;
  const subtotalCents = newStayCents + fixedTripCostCents;
  const bufferEstimateCents = Math.round(subtotalCents * 0.12);
  return {
    stayEstimateCents: newStayCents,
    bufferEstimateCents,
    totalEstimateCents: subtotalCents + bufferEstimateCents
  };
}

function stayConfidenceLabel(option: StayOption): BudgetCategoryConfidenceLabel {
  return option.priceType === "live_partner"
    ? "Live price"
    : option.priceType === "cached_recent"
      ? "Recently searched"
      : "Conservative estimate";
}

/**
 * The traveller's confirmed pick from the stay selector, applied to
 * a completed discovery — the exact mirror of
 * applyTransportOptionSelection: pure re-tabulation with the
 * discovery's own formula (see retabulateStayTotals), budget status
 * recomputed with the same calculateBudgetStatus the engine used,
 * and the pick stamped as staySelection so it is never confused with
 * the engine's hotel estimate downstream.
 *
 * Guard rails: a stay with no displayable price can never be
 * applied, a pick outside the discovery's own stay options can never
 * be applied when the discovery carries them, and a trip whose
 * budget excludes the hotel keeps its totals untouched — the
 * discovery is returned unchanged in every guard case.
 */
export function applyStayOptionSelection(discovery: TripPriceDiscovery, option: StayOption): TripPriceDiscovery {
  if (!option || discovery.budgetIncludesHotel === false) return discovery;
  const newStayCents = stayOptionCostCents(option);
  if (newStayCents == null) return discovery;
  if (Array.isArray(discovery.stayOptions) && discovery.stayOptions.length) {
    if (!discovery.stayOptions.some((candidate) => candidate.id === option.id)) return discovery;
  }

  const totals = retabulateStayTotals(
    {
      totalEstimateCents: discovery.totalEstimateCents,
      bufferEstimateCents: discovery.bufferEstimateCents,
      stayEstimateCents: discovery.hotelEstimateCents
    },
    newStayCents
  );
  const budget = calculateBudgetStatus({
    budgetAmount: discovery.budgetAmount,
    budgetCurrency: discovery.budgetCurrency,
    totalEstimateCents: totals.totalEstimateCents,
    committedBudgetCents: discovery.committedBudgetCents,
    committedBookingStatus: discovery.committedBookingCostStatus
  });

  const stayOptions = Array.isArray(discovery.stayOptions)
    ? discovery.stayOptions.map((candidate) => ({ ...candidate, suggested: candidate.id === option.id }))
    : discovery.stayOptions;

  const budgetCategoryConfidence = discovery.budgetCategoryConfidence.map((entry) =>
    entry.category === "hotel"
      ? {
          ...entry,
          label: stayConfidenceLabel(option),
          amountCents: newStayCents,
          source: option.source || entry.source,
          note:
            option.priceType === "live_partner"
              ? "Live partner hotel price used. Refresh before booking."
              : option.priceType === "cached_recent"
                ? "Recently searched hotel price used. Refresh before booking."
                : entry.note
        }
      : entry
  );

  return {
    ...discovery,
    stayOptions,
    staySelection: { candidateId: option.id, title: option.title, selectedBy: "traveler" as const },
    hotelEstimateCents: totals.stayEstimateCents,
    bufferEstimateCents: totals.bufferEstimateCents,
    totalEstimateCents: totals.totalEstimateCents,
    remainingBudgetCents: budget.remainingBudgetCents,
    budgetStatus: budget.budgetStatus,
    budgetCategoryConfidence
  };
}

/**
 * Generation/repair honouring for a stored stay pick. A re-discovery
 * (market refresh, staged re-generation) re-derives every estimate
 * from scratch — but the traveller's confirmed stay is not an
 * estimate, and the priority law puts a traveller's confirmed choice
 * above a fresh recommendation. When the picked candidate is still
 * among the stay options valid NOW at a displayable price, the pick
 * is re-applied to the fresh discovery: the stamp survives and the
 * stay line re-tabulates from the fresh discovery's own fixed costs
 * at the option's current price. When the candidate is gone or no
 * longer priced, the fresh discovery is returned unchanged — the
 * pick is released rather than priced from stale figures, and the
 * traveller can pick again from the selector. A trip with no stored
 * selection is returned untouched (same object).
 */
export function carryForwardStaySelection(
  discovery: TripPriceDiscovery,
  previousSelection: StaySelection | null | undefined,
  options: StayOption[]
): TripPriceDiscovery {
  if (!previousSelection?.candidateId) return discovery;
  const option = options.find((candidate) => candidate.id === previousSelection.candidateId) || null;
  if (!option || stayOptionCostCents(option) == null) return discovery;
  return applyStayOptionSelection({ ...discovery, stayOptions: options }, option);
}
