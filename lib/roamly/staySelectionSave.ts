/**
 * The stay pick's write-back core (owner's settings-persist law: a
 * pick that re-tabulates on screen and vanishes on reload is a
 * defect). Pure orchestration used by the stay-selection route:
 *
 *   stored discovery row → discoveryFromDatabaseRow (rehydrate)
 *   → stay options built from the trip's OWN stored hotel
 *     suggestions (the same source the trip page renders)
 *   → applyStayOptionSelection (the engine's own re-tabulation)
 *   → applyPriceDiscoveryToItinerary (the breakdown the page reads)
 *
 * The route then persists with the surface's existing pattern —
 * savePriceDiscovery (a NEW discovery row, the trip relinked to it)
 * and syncGeneratedItinerary — the same append-only tail the market
 * refresh path uses. Nothing here invents a price: an option the
 * trip does not carry, or one without a displayable price, is a
 * refusal, never a save.
 */
import type { RoamlyItinerary } from "@/lib/itinerary";
import {
  applyPriceDiscoveryToItinerary,
  discoveryFromDatabaseRow,
  type TripPriceDiscovery,
  type TripPriceDiscoveryInput
} from "@/lib/roamly/priceDiscovery";
import {
  applyStayOptionSelection,
  buildStayOptions,
  stayOptionCostCents,
  type StaySelection
} from "@/lib/roamly/stayOptions";

export type StaySelectionSaveRefusal = "NO_DISCOVERY_ROW" | "OPTION_UNAVAILABLE" | "SELECTION_NOT_APPLIED";

export type StaySelectionSave =
  | {
      ok: true;
      discovery: TripPriceDiscovery;
      input: TripPriceDiscoveryInput & { userId: string };
      itinerary: RoamlyItinerary;
      selection: StaySelection;
      totals: { stayEstimateCents: number; bufferEstimateCents: number; totalEstimateCents: number };
    }
  | { ok: false; reason: StaySelectionSaveRefusal };

export function prepareStaySelectionSave(params: {
  discoveryRow: Record<string, unknown> | null | undefined;
  itinerary: RoamlyItinerary;
  optionId: string;
  nights: number;
}): StaySelectionSave {
  const rehydrated = discoveryFromDatabaseRow(params.discoveryRow);
  if (!rehydrated) return { ok: false, reason: "NO_DISCOVERY_ROW" };

  // The trip's own stored suggestions are the option source — the
  // same list the selector rendered. Identity is the suggestion's
  // candidateId (buildStayOptions' rule), which every priced
  // suggestion carries; unpriced rows can never be picked.
  const options = buildStayOptions(params.itinerary.booking_suggestions || [], params.nights);
  const option = options.find((candidate) => candidate.id === params.optionId) || null;
  if (!option || stayOptionCostCents(option) == null) return { ok: false, reason: "OPTION_UNAVAILABLE" };

  const applied = applyStayOptionSelection({ ...rehydrated.discovery, stayOptions: options }, option);
  if (!applied.staySelection || applied.staySelection.candidateId !== option.id) {
    return { ok: false, reason: "SELECTION_NOT_APPLIED" };
  }

  return {
    ok: true,
    discovery: applied,
    input: rehydrated.input,
    itinerary: applyPriceDiscoveryToItinerary(params.itinerary, applied),
    selection: applied.staySelection,
    totals: {
      stayEstimateCents: applied.hotelEstimateCents,
      bufferEstimateCents: applied.bufferEstimateCents,
      totalEstimateCents: applied.totalEstimateCents
    }
  };
}
