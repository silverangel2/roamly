/**
 * The transport pick's write-back core (Stage 7, 2026-11-11 — the
 * transport twin of staySelectionSave.ts; the owner's
 * settings-persist law: a pick that re-tabulates on screen and
 * vanishes on reload is a defect). Pure orchestration used by the
 * transport-selection route:
 *
 *   stored discovery row → discoveryFromDatabaseRow (rehydrate)
 *   → the option is found in the discovery's OWN stored
 *     transportOptions (the same set the trip page renders from
 *     the itinerary breakdown)
 *   → applyTransportOptionSelection (the engine's own
 *     re-tabulation + the transportSelection stamp)
 *   → applyPriceDiscoveryToItinerary (the breakdown the page reads)
 *
 * The route then persists with the surface's existing pattern —
 * savePriceDiscovery (a NEW discovery row, the trip relinked to
 * it) and syncGeneratedItinerary — the same append-only tail the
 * stay seam uses. Nothing here invents a price or a time: an
 * option the trip does not carry, or one the logic map excluded
 * or marks unavailable, is a refusal, never a save; and the day
 * legs keep their generated times — the pick restamps the
 * discovery and the budget breakdown (where the option's duration
 * stays labelled an estimate), never a leg's clock time.
 */
import type { RoamlyItinerary } from "@/lib/itinerary";
import {
  applyPriceDiscoveryToItinerary,
  applyTransportOptionSelection,
  discoveryFromDatabaseRow,
  type TransportSelection,
  type TripPriceDiscovery,
  type TripPriceDiscoveryInput
} from "@/lib/roamly/priceDiscovery";
import type { TransportOption } from "@/lib/roamly/transportOptions";

export type TransportSelectionSaveRefusal = "NO_DISCOVERY_ROW" | "OPTION_UNAVAILABLE" | "SELECTION_NOT_APPLIED";

export type TransportSelectionSave =
  | {
      ok: true;
      discovery: TripPriceDiscovery;
      input: TripPriceDiscoveryInput & { userId: string };
      itinerary: RoamlyItinerary;
      selection: TransportSelection;
      totals: { transportEstimateCents: number; bufferEstimateCents: number; totalEstimateCents: number };
    }
  | { ok: false; reason: TransportSelectionSaveRefusal };

/** The selector's wire identity for an option: mode + title — the
 *  same identity applyTransportOptionSelection matches on. */
export function transportOptionKey(option: Pick<TransportOption, "mode" | "title">): string {
  return `${option.mode}::${option.title}`;
}

export function parseTransportOptionKey(key: string): { mode: string; title: string } | null {
  const separator = key.indexOf("::");
  if (separator <= 0) return null;
  const mode = key.slice(0, separator).trim();
  const title = key.slice(separator + 2).trim();
  return mode && title ? { mode, title } : null;
}

export function prepareTransportSelectionSave(params: {
  discoveryRow: Record<string, unknown> | null | undefined;
  itinerary: RoamlyItinerary;
  optionKey: string;
}): TransportSelectionSave {
  const rehydrated = discoveryFromDatabaseRow(params.discoveryRow);
  if (!rehydrated) return { ok: false, reason: "NO_DISCOVERY_ROW" };

  const wanted = parseTransportOptionKey(params.optionKey);
  const option = wanted
    ? rehydrated.discovery.transportOptions.find(
        (candidate) => candidate.mode === wanted.mode && candidate.title === wanted.title
      ) || null
    : null;
  if (!option) return { ok: false, reason: "OPTION_UNAVAILABLE" };

  const applied = applyTransportOptionSelection(rehydrated.discovery, option);
  if (
    !applied.transportSelection ||
    applied.transportSelection.mode !== option.mode ||
    applied.transportSelection.title !== option.title
  ) {
    return { ok: false, reason: "SELECTION_NOT_APPLIED" };
  }

  return {
    ok: true,
    discovery: applied,
    input: rehydrated.input,
    itinerary: applyPriceDiscoveryToItinerary(params.itinerary, applied),
    selection: applied.transportSelection,
    totals: {
      transportEstimateCents: applied.selectedTransportEstimateCents,
      bufferEstimateCents: applied.bufferEstimateCents,
      totalEstimateCents: applied.totalEstimateCents
    }
  };
}
