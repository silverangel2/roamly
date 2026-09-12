import type { HotelProductDecision, HotelProductRequirements } from "./hotelProductDecision.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { evaluateHotelProductOptions } from "./hotelProductDecision.ts";
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { hotelCandidateIsFresh, type HotelProductOption } from "./hotelInventory.ts";
import type { HotelConstraints } from "../trip-planner";

export type SelectedHotelProductDecisionInput = {
  priceDiscovery?: Record<string, unknown> | null;
  hotelConstraints?: HotelConstraints;
  productRequirements?: HotelProductRequirements;
  confirmedBookings?: Array<{ booking_type?: string | null; booking_status?: string | null }> | null;
  now?: Date;
};

export type SelectedHotelProductDecisionResult = {
  status: "EVALUATED" | "CONFIRMED_BOOKING" | "NO_SELECTED_HOTEL" | "SELECTED_HOTEL_NOT_FOUND" | "NO_PRODUCT_OPTIONS" | "STALE_REQUIRES_REVALIDATION" | "INVALID_SELECTED_INVENTORY";
  selectedHotelCandidateId: string | null;
  providerPropertyId: string | null;
  inventoryFreshness: "fresh" | "stale" | "unknown";
  requiresRevalidation: boolean;
  representativeProviderProductId: string | null;
  productDecision: HotelProductDecision | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stayNights(start: unknown, end: unknown) {
  const startMs = Date.parse(text(start));
  const endMs = Date.parse(text(end));
  const nights = Math.ceil((endMs - startMs) / 86_400_000);
  return Number.isFinite(nights) && nights > 0 ? nights : null;
}

function option(value: unknown): HotelProductOption | null {
  const row = record(value);
  if (!row) return null;
  const availabilityStatus = row.availabilityStatus === "available" || row.availabilityStatus === "unverified" || row.availabilityStatus === "unknown"
    ? row.availabilityStatus
    : "unknown";
  const taxInclusionStatus = row.taxInclusionStatus === "included" || row.taxInclusionStatus === "excluded" || row.taxInclusionStatus === "unknown"
    ? row.taxInclusionStatus
    : "unknown";
  const feeInclusionStatus = row.feeInclusionStatus === "included" || row.feeInclusionStatus === "excluded" || row.feeInclusionStatus === "unknown"
    ? row.feeInclusionStatus
    : "unknown";
  return {
    providerProductId: text(row.providerProductId) || null,
    roomDescription: text(row.roomDescription) || null,
    totalStayPrice: optionalNumber(row.totalStayPrice),
    currency: text(row.currency) || null,
    taxesFees: optionalNumber(row.taxesFees),
    taxInclusionStatus,
    feeInclusionStatus,
    availabilityStatus,
    cancellationPolicy: text(row.cancellationPolicy) || null,
    deepLink: text(row.deepLink) || null
  };
}

function confirmedHotelBooking(bookings: SelectedHotelProductDecisionInput["confirmedBookings"]) {
  const statuses = new Set(["booked", "paid", "reserved", "confirmed", "modified", "completed"]);
  return (bookings || []).some((booking) => booking.booking_type === "hotel" && statuses.has(text(booking.booking_status).toLowerCase()));
}

function marketRows(priceDiscovery: Record<string, unknown>) {
  const rows = [
    ...(Array.isArray(priceDiscovery.selectedMarketPrices) ? priceDiscovery.selectedMarketPrices : []),
    ...(Array.isArray(priceDiscovery.marketResults) ? priceDiscovery.marketResults : [])
  ];
  return rows.map(record).filter((row): row is Record<string, unknown> => Boolean(row));
}

function marketFingerprint(row: Record<string, unknown>) {
  const metadata = record(row.metadata);
  const providerPayload = record(metadata?.providerPayload);
  const products = Array.isArray(providerPayload?.product_options)
    ? providerPayload.product_options.map((value) => {
      const product = record(value);
      return { id: text(product?.providerProductId), price: optionalNumber(product?.totalStayPrice), currency: text(product?.currency) };
    }).sort((a, b) => a.id.localeCompare(b.id))
    : null;
  return JSON.stringify({
    source: row.source,
    retrievalProvider: metadata?.retrieval_provider,
    propertyId: text(providerPayload?.property_id),
    expiresAt: text(row.expires_at),
    currency: text(row.currency),
    products
  });
}

export function resolveSelectedHotelProductDecision(input: SelectedHotelProductDecisionInput): SelectedHotelProductDecisionResult {
  const discovery = record(input.priceDiscovery);
  const groundedDecision = record(discovery?.groundedDecision);
  const selectedId = text(groundedDecision?.selectedHotelCandidateId) || null;
  const base = {
    selectedHotelCandidateId: selectedId,
    providerPropertyId: null,
    inventoryFreshness: "unknown" as const,
    requiresRevalidation: false,
    representativeProviderProductId: null,
    productDecision: null
  };
  if (!selectedId) return { ...base, status: "NO_SELECTED_HOTEL" };
  if (confirmedHotelBooking(input.confirmedBookings)) return { ...base, status: "CONFIRMED_BOOKING" };
  const matchingMarkets = marketRows(discovery || {}).filter((row) => text(row.id) === selectedId && row.category === "hotel");
  if (matchingMarkets.length > 1 && new Set(matchingMarkets.map(marketFingerprint)).size > 1) return { ...base, status: "INVALID_SELECTED_INVENTORY" };
  const market = matchingMarkets[0];
  if (!market) return { ...base, status: "SELECTED_HOTEL_NOT_FOUND" };
  const metadata = record(market.metadata);
  const providerPayload = record(metadata?.providerPayload);
  if (market.source !== "booking_demand" || metadata?.retrieval_provider !== "provider_api") return { ...base, status: "INVALID_SELECTED_INVENTORY" };
  const providerPropertyId = text(providerPayload?.property_id) || null;
  if (!providerPropertyId) return { ...base, status: "INVALID_SELECTED_INVENTORY" };
  const productOptions = Array.isArray(providerPayload?.product_options)
    ? providerPayload.product_options.map(option).filter((item): item is HotelProductOption => Boolean(item))
    : [];
  const stableProductIds = new Set(productOptions.map((item) => item.providerProductId).filter((id): id is string => Boolean(id)));
  if (stableProductIds.size !== productOptions.filter((item) => item.providerProductId).length) return { ...base, status: "INVALID_SELECTED_INVENTORY", providerPropertyId };
  const persistedRepresentative = text(providerPayload?.representative_product_id) || text(providerPayload?.product_id) || null;
  const representativeProviderProductId = persistedRepresentative && stableProductIds.has(persistedRepresentative) ? persistedRepresentative : null;
  const expiresAt = text(market.expires_at);
  const fresh = hotelCandidateIsFresh({ expiresAt }, input.now || new Date());
  const selectedProperty = {
    candidateId: selectedId,
    providerPropertyId,
    currency: text(market.currency),
    productOptions
  };
  if (!productOptions.length || !stableProductIds.size) return { ...base, status: "NO_PRODUCT_OPTIONS", providerPropertyId, inventoryFreshness: fresh ? "fresh" : expiresAt ? "stale" : "unknown", requiresRevalidation: !fresh, representativeProviderProductId };
  const decision = evaluateHotelProductOptions({
    selectedProperty,
    travelerRequirements: { hotel: input.hotelConstraints, product: input.productRequirements },
    budgetContext: { comparisonCurrency: text(market.currency) || null },
    nights: stayNights(market.start_date, market.end_date),
    confirmedHotelBooking: false
  });
  return {
    status: fresh ? "EVALUATED" : "STALE_REQUIRES_REVALIDATION",
    selectedHotelCandidateId: selectedId,
    providerPropertyId,
    inventoryFreshness: fresh ? "fresh" : expiresAt ? "stale" : "unknown",
    requiresRevalidation: !fresh,
    representativeProviderProductId,
    productDecision: decision
  };
}
