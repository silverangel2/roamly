/*
 * The generation price-discovery segment, shared by BOTH generation
 * context preparations (the incumbent staged prep and the zero-engine
 * prep). Extracted verbatim from prepareStagedGenerationContext
 * (2026-11-11, discovery-persistence fix) so the two paths can never
 * drift apart again: market search -> price discovery -> grounded
 * decision -> pack augmentation -> stay/transport pick
 * carry-forwards -> save + link.
 *
 * Why the engine prep runs it too: since the 2026-10-22 wiring ship
 * (ROAMLY_ZERO_ENGINE_ENABLED=true), every generation routes to the
 * zero-engine, whose prep never ran this segment — no discovery was
 * ever saved, so every trip since carries
 * latest_price_discovery_id = NULL and transport/stay selection,
 * selected-hotel actions and the budget-change preview all degrade
 * or refuse (ROOT-CAUSE: discovery-persistence/ROOT-CAUSE.md). The
 * segment is the single writer of that record; both preps now call
 * it before generation starts and downstream consumers read the
 * stored row, exactly as the incumbent always worked.
 *
 * Failure law (Stage 6 truth discipline): a failed save is LOUD.
 * The helper logs a price_discovery_save_failed diagnostic and
 * returns the failure in `saveFailure`; each caller records it on
 * the generation state. Generation may proceed (the discovery is a
 * side record), but a silent null discovery is impossible.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBudgetConstraintForItinerary,
  carryForwardTransportSelection,
  discoverTripPrices,
  savePriceDiscovery,
  transportSelectionFromRow,
  type TransportSelection
} from "@/lib/roamly/priceDiscovery";
import {
  carryForwardStaySelection,
  type StayOption,
  type StaySelection
} from "@/lib/roamly/stayOptions";
import {
  searchTripMarketPrices,
  type TravelMarketResult
} from "@/lib/roamly/travelMarketSearch";
import {
  buildGroundedDecisionCore,
  optimizeGroundedDecision
} from "@/lib/roamly/candidateDecisionCore";
import {
  augmentMarketResultsWithPackFallback,
  packFallbackMarketResults
} from "@/lib/roamly/timelineGrounding";
import { logGenerationDiagnostic } from "@/lib/roamly/generationDiagnostics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ConfirmedBookingCost } from "@/lib/roamly/bookings";
import type { TravelerPersonalizationContext } from "@/lib/roamly/travelerPersonalization";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type PriceDiscoverySaveFailure = {
  tripId: string;
  message: string;
};

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizedTextKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * KF-1 named-pool fallback (2026-11-03): when the market pool names no
 * place for a category, add the destination pack's named inventory
 * (stays / sights / foods already collected for the zero-engine) to
 * the discovery pool as candidates, so the staged path can ground a
 * thin destination in real named places instead of collapsing to
 * search-query fallbacks. READ-ONLY against the pack store (a missing
 * or unbuilt pack simply means no fallback) and fail-soft: any error
 * returns the discovery unchanged. This runs once per generation at
 * context preparation — no extra model calls, no extra egress beyond
 * the pack rows themselves.
 */
async function augmentDiscoveryWithPackFallback<T extends { marketResults?: TravelMarketResult[] }>(
  payload: TripPlannerPayload,
  discovery: T
): Promise<T> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return discovery;
    const [{ SupabasePackStore }, { assembleEnginePack }] = await Promise.all([
      import("@/lib/roamly/engine/packs/supabaseStore"),
      import("@/lib/roamly/engine/packs/builder")
    ]);
    const store = new SupabasePackStore(admin);
    const targetName = normalizedTextKey(payload.destination || payload.destinationCity || "");
    if (!targetName) return discovery;
    const destinations = await store.listDestinations();
    const destination =
      destinations.find(
        (entry) =>
          normalizedTextKey(entry.displayName) === targetName &&
          (!payload.destinationCountry ||
            !entry.country ||
            normalizedTextKey(entry.country) === normalizedTextKey(payload.destinationCountry))
      ) || destinations.find((entry) => normalizedTextKey(entry.displayName) === targetName);
    if (!destination) return discovery;
    const ready = await store.getReadyVersion(destination.destinationId);
    if (!ready) return discovery;
    const candidates = await store.getVersionCandidates(ready.dto.packVersionId);
    if (!candidates.length) return discovery;
    const pack = assembleEnginePack(destination, ready, candidates, []);
    const packResults = packFallbackMarketResults(pack, {
      destination: payload.destination || payload.destinationCity || destination.displayName,
      country: payload.destinationCountry || destination.country,
      currency: payload.budgetCurrency,
      startDate: payload.startDate
    });
    const existing = discovery.marketResults || [];
    const marketResults = augmentMarketResultsWithPackFallback(
      existing,
      packResults,
      payload.destination || payload.destinationCity
    );
    if (marketResults.length === existing.length) return discovery;
    return { ...discovery, marketResults };
  } catch {
    return discovery;
  }
}

/**
 * The trip's stored stay pick (selection + the option set it was
 * made from), read from its latest discovery row. A re-generation
 * re-derives every estimate from scratch; the traveller's confirmed
 * stay is not an estimate, so generation carries it forward
 * (carryForwardStaySelection) instead of silently replacing it with
 * a fresh hotel estimate. Null for a trip with no stored pick (or
 * no stored option set to re-apply it from).
 */
async function loadStoredStaySelection(
  supabase: SupabaseClient,
  userId: string,
  tripId: string
): Promise<{ selection: StaySelection; options: StayOption[] } | null> {
  const tripResult = await supabase
    .from("roamly_trips")
    .select("latest_price_discovery_id")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  const discoveryId = getString(tripResult.data?.latest_price_discovery_id, "");
  if (!discoveryId) return null;
  const rowResult = await supabase
    .from("roamly_price_discoveries")
    .select("metadata")
    .eq("id", discoveryId)
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  const metadata = getRecord(rowResult.data?.metadata);
  const rawSelection = getRecord(metadata?.staySelection);
  const candidateId = getString(rawSelection?.candidateId, "");
  if (!candidateId) return null;
  const options = Array.isArray(metadata?.stayOptions) ? (metadata.stayOptions as StayOption[]) : [];
  if (!options.length) return null;
  return {
    selection: { candidateId, title: getString(rawSelection?.title, ""), selectedBy: "traveler" },
    options
  };
}

/**
 * The trip's stored transport pick from its latest discovery row
 * (Stage 7, 2026-11-11 — the transport twin of
 * loadStoredStaySelection). A re-generation carries it forward
 * (carryForwardTransportSelection) instead of silently replacing
 * it with the logic map's fresh recommendation.
 */
async function loadStoredTransportSelection(
  supabase: SupabaseClient,
  userId: string,
  tripId: string
): Promise<TransportSelection | null> {
  const tripResult = await supabase
    .from("roamly_trips")
    .select("latest_price_discovery_id")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  const discoveryId = getString(tripResult.data?.latest_price_discovery_id, "");
  if (!discoveryId) return null;
  const rowResult = await supabase
    .from("roamly_price_discoveries")
    .select("*")
    .eq("id", discoveryId)
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  return transportSelectionFromRow((rowResult.data as Record<string, unknown> | null) ?? null);
}

/**
 * The discovery segment both generation preps run before generation
 * starts: compute the trip's price discovery from a live market
 * search, honour any stored stay/transport picks, save the discovery
 * and link it to the trip (savePriceDiscovery writes
 * roamly_trips.latest_price_discovery_id). Inputs are the values
 * each prep already loads its own way (committed booking cost,
 * confirmed bookings, personalization); everything downstream of
 * them is the incumbent's segment, unchanged.
 *
 * On a save failure the generation may proceed, but the failure is
 * returned (and diagnostic-logged) so the caller records it on the
 * generation state — never a silent null.
 */
export async function prepareGenerationDiscovery(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  payload: TripPlannerPayload;
  committedBookingCost: ConfirmedBookingCost;
  confirmedBookings: TripPlannerPayload["confirmedBookings"];
  personalization: TravelerPersonalizationContext;
}): Promise<{
  priceDiscovery: Record<string, unknown>;
  priceDiscoveryId: string | null;
  budgetConstraint: string;
  saveFailure: PriceDiscoverySaveFailure | null;
}> {
  const marketSearch = await searchTripMarketPrices(params.payload, {
    supabase: params.supabase,
    store: true
  });
  const discovery = await discoverTripPrices({
    userId: params.userId,
    tripId: params.tripId,
    ...params.payload,
    committedBookingCost: params.committedBookingCost,
    confirmedBookings: params.confirmedBookings,
    marketResults: marketSearch.results
  });
  const groundedDecision = optimizeGroundedDecision({
    decision: buildGroundedDecisionCore({
      payload: params.payload,
      marketResults: marketSearch.results,
      confirmedBookings: params.confirmedBookings,
      personalization: params.personalization
    }),
    payload: params.payload,
    confirmedBookings: params.confirmedBookings,
    allowances: [
      { category: "food", description: "Food allowance", amount: discovery.foodEstimateCents / 100, source: "Roamly planning estimate", status: "estimated" },
      { category: "local_transport", description: "Local transport allowance", amount: discovery.localTransportEstimateCents / 100, source: "Roamly planning estimate", status: "estimated" },
      { category: "buffer", description: "Trip safety buffer", amount: discovery.bufferEstimateCents / 100, source: "Roamly planning estimate", status: "estimated" }
    ]
  });
  const groundedDiscovery = { ...discovery, groundedDecision };
  const packAugmentedDiscovery = await augmentDiscoveryWithPackFallback(params.payload, groundedDiscovery);
  // Stay-pick honouring: a stored traveller pick survives into the
  // generation's discovery (stamp + re-tabulated stay line), so the
  // built itinerary's hotel line is the picked stay's cost — the
  // same way the transport stamp flows through its applied totals.
  const storedStay = await loadStoredStaySelection(params.supabase, params.userId, params.tripId);
  const generationDiscovery = storedStay
    ? carryForwardStaySelection(packAugmentedDiscovery, storedStay.selection, storedStay.options)
    : packAugmentedDiscovery;
  // Transport-pick honouring (Stage 7, 2026-11-11): the stored
  // transport pick is carried into the generation's discovery the
  // same way — stamp + re-tabulated transport line — so a
  // re-generation builds against the traveller's chosen mode
  // (effectiveTransportMode reads the stamp before the preference
  // string) instead of silently reverting to the recommendation.
  const storedTransport = await loadStoredTransportSelection(params.supabase, params.userId, params.tripId);
  const carriedDiscovery = carryForwardTransportSelection(generationDiscovery, storedTransport);
  const savedDiscovery = await savePriceDiscovery(
    params.supabase,
    { userId: params.userId, tripId: params.tripId, ...params.payload },
    carriedDiscovery
  );
  const saveFailure: PriceDiscoverySaveFailure | null = savedDiscovery.error
    ? { tripId: params.tripId, message: savedDiscovery.error }
    : null;
  if (saveFailure) {
    logGenerationDiagnostic("price_discovery_save_failed", {
      tripId: params.tripId,
      stage: "generation_context_prep",
      error: saveFailure.message
    });
  }
  return {
    priceDiscovery: carriedDiscovery as unknown as Record<string, unknown>,
    priceDiscoveryId: savedDiscovery.id || params.payload.priceDiscoveryId || null,
    budgetConstraint: buildBudgetConstraintForItinerary(
      carriedDiscovery !== packAugmentedDiscovery ? carriedDiscovery : discovery
    ),
    saveFailure
  };
}
