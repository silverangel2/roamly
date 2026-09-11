import type {
  ActivityConstraints,
  ConstraintPriority,
  ExplicitTravelRequirement,
  FlightConstraints,
  HotelConstraints,
  TravelConstraint,
  TravelConstraints,
  TripPlannerPayload
} from "@/lib/trip-planner";

export type CandidateCategory = "flight" | "hotel" | "activity";
export type CandidateFactualStatus = "verified" | "search_ready" | "estimated" | "unknown";
export type CandidateSourceType = "provider_api" | "discovery" | "referral" | "fallback";
export type CandidateBookingStatus = "bookable" | "search_only" | "availability_unverified" | "unknown";

export type CandidateBase = {
  candidateId: string;
  category: CandidateCategory;
  source: string;
  sourceType: CandidateSourceType;
  searchedAt: string | null;
  factualStatus: CandidateFactualStatus;
  bookingStatus: CandidateBookingStatus;
  deepLink: string | null;
  score?: number;
  scoreReasons?: string[];
};

export type FlightCandidate = CandidateBase & {
  category: "flight";
  providerOfferId: string | null;
  airline: string | null;
  flightNumbers: string[];
  originAirport: string | null;
  destinationAirport: string | null;
  departureAt: string | null;
  arrivalAt: string | null;
  durationMinutes: number | null;
  stops: number | null;
  cabin: string | null;
  baggage: string | null;
  price: number | null;
  currency: string;
  taxesFees: number | null;
  totalPrice: number | null;
};

export type HotelCandidate = CandidateBase & {
  category: "hotel";
  providerPropertyId: string | null;
  name: string;
  coordinates: { latitude: number; longitude: number } | null;
  neighborhood: string | null;
  checkIn: string | null;
  checkOut: string | null;
  roomDescription: string | null;
  amenities: string[];
  pricePerNight: number | null;
  totalStayPrice: number | null;
  taxesFees: number | null;
  currency: string;
  availabilityStatus: "available" | "unverified" | "unknown";
};

export type ActivityCandidate = CandidateBase & {
  category: "activity";
  providerActivityId: string | null;
  canonicalName: string;
  coordinates: { latitude: number; longitude: number } | null;
  date: string | null;
  startTime: string | null;
  openingHours: string | null;
  durationMinutes: number | null;
  price: number | null;
  currency: string;
  availabilityStatus: "available" | "unverified" | "unknown";
  bookingRequired: boolean | null;
};

export type GroundedCandidate = FlightCandidate | HotelCandidate | ActivityCandidate;

type MarketResult = {
  id: string;
  category: string;
  title: string;
  provider?: string;
  source?: string;
  price_amount?: number;
  price_min?: number;
  price_max?: number;
  currency?: string;
  price_type?: string;
  booking_url?: string;
  affiliate_url?: string;
  normal_search_url?: string;
  searched_at?: string;
  origin?: string;
  destination?: string;
  city?: string;
  start_date?: string;
  end_date?: string;
  rooms?: number;
  metadata?: Record<string, unknown>;
};

type ConfirmedBooking = {
  booking_type?: string | null;
  title?: string | null;
  provider_name?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
};

export type BudgetLedgerLine = {
  category: string;
  candidateId: string | null;
  bookingId: string | null;
  description: string;
  amount: number | null;
  currency: string;
  priceStatus: "confirmed" | "live_search" | "estimated" | "unknown";
  source: string;
  includedInTotal: boolean;
  confidence: CandidateFactualStatus | "confirmed";
};

export type BudgetLedger = {
  currency: string;
  customerBudget: number | null;
  lines: BudgetLedgerLine[];
  knownTotal: number;
  unknownLineCount: number;
  remaining: number | null;
  status: "WITHIN_BUDGET" | "LIKELY_WITHIN_BUDGET" | "OVER_BUDGET" | "BUDGET_UNCERTAIN";
  amountOverBudget: number;
};

export type CandidateRecommendations = {
  BEST_MATCH: string | null;
  BEST_VALUE: string | null;
  LOWEST_PRICE: string | null;
  recommendedCandidateId: string | null;
  rationale: Record<string, string[]>;
};

export type GroundedDecision = {
  candidates: GroundedCandidate[];
  eligibleCandidateIds: string[];
  recommendations: Record<CandidateCategory, CandidateRecommendations>;
  selectedFlightCandidateId: string | null;
  selectedHotelCandidateId: string | null;
  selectedActivityCandidateIds: string[];
  unresolvedExactRequests: Array<{ request: string; status: "UNRESOLVED_EXACT_REQUEST"; reason: string }>;
  budgetLedger: BudgetLedger;
  tradeoffOptions: Array<{ change: CandidateCategory; savings: number; candidateId: string; description: string }>;
  selectedAt: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function payloadFrom(result: MarketResult) {
  return record(record(result.metadata).providerPayload);
}

function providerField(result: MarketResult, ...keys: string[]) {
  const payload = payloadFrom(result);
  for (const key of keys) {
    const value = result[key as keyof MarketResult] ?? payload[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function sourceType(result: MarketResult): CandidateSourceType {
  if (result.source === "stay22") return "referral";
  if (result.price_type === "live_partner") return "provider_api";
  if (result.price_type === "search_ready") return result.source === "stay22" ? "referral" : "discovery";
  if (result.price_type === "estimated_fallback") return "fallback";
  return "discovery";
}

function factualStatus(result: MarketResult): CandidateFactualStatus {
  if (result.source === "stay22") return "search_ready";
  if (result.price_type === "live_partner") return "verified";
  if (result.price_type === "estimated_fallback") return "estimated";
  if (result.price_type === "search_ready") return "search_ready";
  return "unknown";
}

function bookingStatus(result: MarketResult): CandidateBookingStatus {
  if (result.source === "stay22" || result.price_type === "search_ready") return "search_only";
  if (result.price_type === "live_partner" && result.booking_url) return "bookable";
  return "availability_unverified";
}

function price(result: MarketResult) {
  return result.price_amount ?? result.price_max ?? result.price_min ?? null;
}

function metadataList(result: MarketResult, key: string) {
  const value = providerField(result, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeMarketCandidate(result: MarketResult): GroundedCandidate | null {
  const category = result.category === "flight" ? "flight" : result.category === "hotel" ? "hotel" : ["attraction", "tour"].includes(result.category) ? "activity" : null;
  if (!category) return null;
  const base = {
    candidateId: result.id,
    category,
    source: result.provider || result.source || "unknown",
    sourceType: sourceType(result),
    searchedAt: result.searched_at || null,
    factualStatus: factualStatus(result),
    bookingStatus: bookingStatus(result),
    deepLink: result.booking_url || result.affiliate_url || result.normal_search_url || null
  } as const;
  const currency = (result.currency || "CAD").toUpperCase();
  if (category === "flight") {
    const rawStops = numberValue(providerField(result, "stops", "number_of_stops", "stopovers"));
    return {
      ...base,
      category,
      providerOfferId: stringValue(providerField(result, "offer_id", "offerId", "id")),
      airline: stringValue(providerField(result, "airline", "airline_name", "carrier")),
      flightNumbers: Array.isArray(providerField(result, "flight_numbers", "flightNumbers")) ? (providerField(result, "flight_numbers", "flightNumbers") as unknown[]).filter((v): v is string => typeof v === "string") : [],
      originAirport: stringValue(providerField(result, "origin_airport", "originAirport", "origin")),
      destinationAirport: stringValue(providerField(result, "destination_airport", "destinationAirport", "destination")),
      departureAt: stringValue(providerField(result, "departure_at", "departureAt", "departure")),
      arrivalAt: stringValue(providerField(result, "arrival_at", "arrivalAt", "arrival")),
      durationMinutes: numberValue(providerField(result, "duration_minutes", "durationMinutes")),
      stops: rawStops,
      cabin: stringValue(providerField(result, "cabin", "cabin_class")),
      baggage: stringValue(providerField(result, "baggage", "baggage_rules")),
      price: price(result),
      currency,
      taxesFees: numberValue(providerField(result, "taxes_fees", "taxesFees")),
      totalPrice: numberValue(providerField(result, "total_price", "totalPrice")) ?? price(result)
    };
  }
  if (category === "hotel") {
    const stay22 = result.source === "stay22";
    return {
      ...base,
      category,
      providerPropertyId: stringValue(providerField(result, "property_id", "propertyId", "listing_id", "listing_identifier")),
      name: result.title,
      coordinates: null,
      neighborhood: stringValue(providerField(result, "neighborhood", "neighbourhood", "district")) || result.city || null,
      checkIn: result.start_date || null,
      checkOut: result.end_date || null,
      roomDescription: stringValue(providerField(result, "room_description", "room_type", "roomDescription")),
      amenities: metadataList(result, "amenities"),
      pricePerNight: numberValue(providerField(result, "price_per_night", "pricePerNight")),
      totalStayPrice: stay22 ? null : price(result),
      taxesFees: stay22 ? null : numberValue(providerField(result, "taxes_fees", "taxesFees")),
      currency,
      availabilityStatus: stay22 ? "unverified" : result.price_type === "live_partner" ? "available" : "unverified"
    };
  }
  return {
    ...base,
    category,
    providerActivityId: stringValue(providerField(result, "activity_id", "activityId", "place_id", "placeId")),
    canonicalName: result.title,
    coordinates: null,
    date: result.start_date || null,
    startTime: stringValue(providerField(result, "start_time", "startTime")),
    openingHours: stringValue(providerField(result, "opening_hours", "openingHours")),
    durationMinutes: numberValue(providerField(result, "duration_minutes", "durationMinutes")),
    price: price(result),
    currency,
    availabilityStatus: result.price_type === "live_partner" ? "available" : "unverified",
    bookingRequired: providerField(result, "booking_required", "bookingRequired") === null ? null : Boolean(providerField(result, "booking_required", "bookingRequired"))
  };
}

function textKey(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function containsMatch(value: string | null | undefined, expected: string) {
  const actual = textKey(value || "");
  const wanted = textKey(expected);
  return Boolean(actual && wanted && (actual === wanted || actual.includes(wanted) || wanted.includes(actual)));
}

function hard<T>(constraint?: TravelConstraint<T>) {
  return constraint?.priority === "hard" ? constraint.value : undefined;
}

export function constraintsFromPayload(payload: TripPlannerPayload): TravelConstraints {
  const explicit = [...(payload.explicitRequirements || []), ...(payload.constraints?.activity?.explicitRequestedActivities || [])];
  const flightRequirements = explicit.filter((item): item is Extract<ExplicitTravelRequirement, { type: "flight" }> => item.type === "flight");
  const hotelRequirements = explicit.filter((item): item is Extract<ExplicitTravelRequirement, { type: "hotel" }> => item.type === "hotel");
  return {
    flight: {
      origin: payload.origin ? { value: payload.origin, priority: "hard" } : undefined,
      destination: payload.destination ? { value: payload.destination, priority: "hard" } : undefined,
      departureDate: payload.startDate ? { value: payload.startDate, priority: "hard" } : undefined,
      returnDate: payload.returnToOrigin !== false && payload.endDate ? { value: payload.endDate, priority: "hard" } : undefined,
      travelerCount: { value: payload.travelersCount || payload.travelers?.adults || 1, priority: "hard" },
      requiredAirlines: flightRequirements.filter((item) => item.priority === "hard" && item.airline).map((item) => item.airline!),
      preferredAirlines: flightRequirements.filter((item) => item.priority === "soft" && item.airline).map((item) => item.airline!)
    },
    hotel: {
      destination: payload.destination ? { value: payload.destination, priority: "hard" } : undefined,
      checkIn: payload.startDate ? { value: payload.startDate, priority: "hard" } : undefined,
      checkOut: payload.endDate ? { value: payload.endDate, priority: "hard" } : undefined,
      travelers: { value: payload.travelersCount || payload.travelers?.adults || 1, priority: "hard" },
      rooms: { value: payload.rooms || 1, priority: "hard" },
      exactPropertyRequest: hotelRequirements[0] ? { value: hotelRequirements[0].request, priority: hotelRequirements[0].priority } : undefined,
      requiredAmenities: payload.accessibilityNeeds ? { value: [payload.accessibilityNeeds], priority: "hard" } : undefined,
      preferredAmenities: payload.bedPreference && payload.bedPreference !== "No preference" ? [payload.bedPreference] : undefined
    },
    activity: {
      explicitRequestedActivities: explicit,
      mustDoActivities: explicit.filter((item) => item.type === "activity" && item.priority === "hard")
    }
  };
}

function matchesHardFlight(candidate: FlightCandidate, constraints: FlightConstraints) {
  if (constraints.requiredAirlines?.length && !constraints.requiredAirlines.some((airline) => containsMatch(candidate.airline, airline))) return false;
  if (constraints.excludedAirlines?.some((airline) => containsMatch(candidate.airline, airline))) return false;
  const maxStops = hard(constraints.maxStops);
  if (maxStops !== undefined && (candidate.stops === null || candidate.stops > maxStops)) return false;
  if (hard(constraints.nonstopRequired) === true && candidate.stops !== 0) return false;
  if (constraints.requiredAirports?.length) {
    const airports = [candidate.originAirport, candidate.destinationAirport].filter(Boolean).join(" ");
    if (!constraints.requiredAirports.some((airport) => containsMatch(airports, airport))) return false;
  }
  return true;
}

function matchesHardHotel(candidate: HotelCandidate, constraints: HotelConstraints) {
  if (hard(constraints.exactPropertyRequest) && !containsMatch(candidate.name, hard(constraints.exactPropertyRequest)!)) return false;
  if (hard(constraints.requiredNeighborhood) && !containsMatch(candidate.neighborhood, hard(constraints.requiredNeighborhood)!)) return false;
  if (hard(constraints.maximumNightlyPrice) !== undefined && candidate.pricePerNight !== null && candidate.pricePerNight > hard(constraints.maximumNightlyPrice)!) return false;
  if (hard(constraints.requiredAmenities)?.length && !hard(constraints.requiredAmenities)!.every((amenity) => candidate.amenities.some((item) => containsMatch(item, amenity)))) return false;
  return true;
}

function matchesHardActivity(candidate: ActivityCandidate, constraints: ActivityConstraints) {
  const mustDo = (constraints.mustDoActivities || []).filter((item): item is Extract<ExplicitTravelRequirement, { type: "activity" }> => item.type === "activity");
  for (const request of mustDo) {
    if (!containsMatch(candidate.canonicalName, request.request)) continue;
    if (request.date && candidate.date && candidate.date !== request.date) return false;
    if (request.date && !candidate.date) return false;
    if (request.time && candidate.startTime && candidate.startTime !== request.time) return false;
    if (request.time && !candidate.startTime) return false;
  }
  return true;
}

function satisfiesActivityRequest(candidate: ActivityCandidate, request: Extract<ExplicitTravelRequirement, { type: "activity" }>) {
  return containsMatch(candidate.canonicalName, request.request) && (!request.date || candidate.date === request.date) && (!request.time || candidate.startTime === request.time);
}

function scoreCandidate(candidate: GroundedCandidate, constraints: TravelConstraints): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = candidate.factualStatus === "verified" ? 60 : candidate.factualStatus === "search_ready" ? 35 : 15;
  if (candidate.category === "flight") {
    if (constraints.flight?.preferredAirlines?.some((item) => containsMatch(candidate.airline, item))) { score += 20; reasons.push("preferred airline"); }
    if (candidate.stops === 0) { score += 8; reasons.push("nonstop"); }
    if (candidate.totalPrice !== null) { score += Math.max(0, 20 - Math.round(candidate.totalPrice / 100)); reasons.push("priced candidate"); }
  } else if (candidate.category === "hotel") {
    if (constraints.hotel?.preferredNeighborhood && containsMatch(candidate.neighborhood, constraints.hotel.preferredNeighborhood)) { score += 20; reasons.push("preferred neighborhood"); }
    if (candidate.totalStayPrice !== null) { score += Math.max(0, 20 - Math.round(candidate.totalStayPrice / 100)); reasons.push("priced stay"); }
  } else {
    const preferred = [...(constraints.activity?.preferredActivities || []), ...(constraints.activity?.mustDoActivities || []).map((item) => item.type === "activity" ? item.request : "")];
    if (preferred.some((item) => containsMatch(candidate.canonicalName, item))) { score += 30; reasons.push("matches requested activity"); }
    if (candidate.price !== null) { score += Math.max(0, 10 - Math.round(candidate.price / 50)); reasons.push("priced activity"); }
  }
  return { score, reasons };
}

function recommendations(category: CandidateCategory, candidates: GroundedCandidate[], constraints: TravelConstraints): CandidateRecommendations {
  const eligible = candidates.filter((candidate) => candidate.category === category);
  const scored = eligible.map((candidate) => ({ candidate, ...scoreCandidate(candidate, constraints) })).sort((a, b) => b.score - a.score || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
  const priced = eligible.filter((candidate) => (candidate.category === "flight" ? candidate.totalPrice : candidate.category === "hotel" ? candidate.totalStayPrice : candidate.price) !== null).sort((a, b) => {
    const amount = (item: GroundedCandidate) => item.category === "flight" ? item.totalPrice! : item.category === "hotel" ? item.totalStayPrice! : item.price!;
    return amount(a) - amount(b);
  });
  const value = [...scored].sort((a, b) => (b.score - (a.candidate.category === "hotel" && a.candidate.totalStayPrice ? a.candidate.totalStayPrice / 100 : 0)) - (a.score - (b.candidate.category === "hotel" && b.candidate.totalStayPrice ? b.candidate.totalStayPrice / 100 : 0)));
  const chosen = scored[0]?.candidate || null;
  return {
    BEST_MATCH: chosen?.candidateId || null,
    BEST_VALUE: value[0]?.candidate.candidateId || null,
    LOWEST_PRICE: priced[0]?.candidateId || null,
    recommendedCandidateId: chosen?.candidateId || null,
    rationale: Object.fromEntries(scored.map((item) => [item.candidate.candidateId, item.reasons]))
  };
}

function candidateAmount(candidate: GroundedCandidate) {
  return candidate.category === "flight" ? candidate.totalPrice : candidate.category === "hotel" ? candidate.totalStayPrice : candidate.price;
}

function priceStatus(candidate: GroundedCandidate): BudgetLedgerLine["priceStatus"] {
  if (candidate.factualStatus === "verified") return "live_search";
  if (candidate.factualStatus === "estimated") return "estimated";
  return "unknown";
}

function budgetLedger(input: { payload: TripPlannerPayload; selected: GroundedCandidate[]; confirmedBookings?: ConfirmedBooking[]; allowances?: Array<{ category: string; description: string; amount: number | null; source: string; status: "estimated" | "unknown" }> }): BudgetLedger {
  const currency = (input.payload.budgetCurrency || "CAD").toUpperCase();
  const lines: BudgetLedgerLine[] = [];
  const confirmedTypes = new Set((input.confirmedBookings || []).map((booking) => booking.booking_type || ""));
  for (const booking of input.confirmedBookings || []) {
    const amount = typeof booking.amount_cents === "number" ? booking.amount_cents / 100 : null;
    lines.push({ category: booking.booking_type || "booking", candidateId: null, bookingId: null, description: booking.title || "Confirmed booking", amount, currency: (booking.currency || currency).toUpperCase(), priceStatus: "confirmed", source: booking.provider_name || "Confirmed booking", includedInTotal: amount !== null, confidence: "confirmed" });
  }
  for (const candidate of input.selected) {
    if (confirmedTypes.has(candidate.category === "flight" ? "flight" : candidate.category === "hotel" ? "hotel" : "activity")) continue;
    const amount = candidateAmount(candidate);
    lines.push({ category: candidate.category, candidateId: candidate.candidateId, bookingId: null, description: candidate.category === "activity" ? candidate.canonicalName : candidate.category === "hotel" ? candidate.name : candidate.airline || "Flight", amount, currency: candidate.currency, priceStatus: priceStatus(candidate), source: candidate.source, includedInTotal: amount !== null && priceStatus(candidate) !== "unknown", confidence: candidate.factualStatus });
  }
  for (const allowance of input.allowances || []) lines.push({ category: allowance.category, candidateId: null, bookingId: null, description: allowance.description, amount: allowance.amount, currency, priceStatus: allowance.status, source: allowance.source, includedInTotal: allowance.amount !== null, confidence: allowance.status === "estimated" ? "estimated" : "unknown" });
  const knownTotal = lines.filter((line) => line.includedInTotal).reduce((sum, line) => sum + (line.amount || 0), 0);
  const unknownLineCount = lines.filter((line) => line.amount === null || line.priceStatus === "unknown").length;
  const remaining = input.payload.budgetAmount == null ? null : input.payload.budgetAmount - knownTotal;
  const status = remaining !== null && remaining < 0 ? "OVER_BUDGET" : unknownLineCount ? "BUDGET_UNCERTAIN" : remaining !== null && remaining >= 0 ? "WITHIN_BUDGET" : "LIKELY_WITHIN_BUDGET";
  return { currency, customerBudget: input.payload.budgetAmount ?? null, lines, knownTotal, unknownLineCount, remaining, status, amountOverBudget: remaining !== null && remaining < 0 ? Math.abs(remaining) : 0 };
}

export function buildGroundedDecisionCore(input: { payload: TripPlannerPayload; marketResults?: MarketResult[] | null; confirmedBookings?: ConfirmedBooking[]; allowances?: Array<{ category: string; description: string; amount: number | null; source: string; status: "estimated" | "unknown" }> }): GroundedDecision {
  const constraints = input.payload.constraints || constraintsFromPayload(input.payload);
  const normalized = (input.marketResults || []).map(normalizeMarketCandidate).filter((candidate): candidate is GroundedCandidate => Boolean(candidate));
  const eligible = normalized.filter((candidate) => candidate.category === "flight" ? matchesHardFlight(candidate, constraints.flight || {}) : candidate.category === "hotel" ? matchesHardHotel(candidate, constraints.hotel || {}) : matchesHardActivity(candidate, constraints.activity || {}));
  const recs = {
    flight: recommendations("flight", eligible, constraints),
    hotel: recommendations("hotel", eligible, constraints),
    activity: recommendations("activity", eligible, constraints)
  };
  const requirements = (constraints.activity?.mustDoActivities || []).filter((item): item is Extract<ExplicitTravelRequirement, { type: "activity" }> => item.type === "activity");
  const unresolvedExactRequests = requirements.filter((request) => !eligible.some((candidate) => candidate.category === "activity" && satisfiesActivityRequest(candidate, request))).map((request) => ({ request: request.request, status: "UNRESOLVED_EXACT_REQUEST" as const, reason: "No matching provider/discovery candidate was returned with the requested date/time." }));
  const selected = eligible.filter((candidate) => [recs.flight.recommendedCandidateId, recs.hotel.recommendedCandidateId, ...requirements.map((request) => eligible.find((item) => item.category === "activity" && satisfiesActivityRequest(item as ActivityCandidate, request))?.candidateId)].includes(candidate.candidateId));
  const confirmedTypes = new Set((input.confirmedBookings || []).map((booking) => booking.booking_type || ""));
  const selectedFlightCandidateId = confirmedTypes.has("flight") ? null : recs.flight.recommendedCandidateId;
  const selectedHotelCandidateId = confirmedTypes.has("hotel") ? null : recs.hotel.recommendedCandidateId;
  return {
    candidates: normalized,
    eligibleCandidateIds: eligible.map((candidate) => candidate.candidateId),
    recommendations: { flight: recs.flight, hotel: recs.hotel, activity: recs.activity },
    selectedFlightCandidateId,
    selectedHotelCandidateId,
    selectedActivityCandidateIds: selected.filter((candidate) => candidate.category === "activity").map((candidate) => candidate.candidateId),
    unresolvedExactRequests,
    budgetLedger: budgetLedger({ payload: input.payload, selected, confirmedBookings: input.confirmedBookings, allowances: input.allowances }),
    tradeoffOptions: [],
    selectedAt: new Date().toISOString()
  };
}

export function optimizeGroundedDecision(input: {
  decision: GroundedDecision;
  payload: TripPlannerPayload;
  confirmedBookings?: ConfirmedBooking[];
  allowances?: Array<{ category: string; description: string; amount: number | null; source: string; status: "estimated" | "unknown" }>;
}) {
  const decision = { ...input.decision, tradeoffOptions: [...input.decision.tradeoffOptions] };
  const byId = new Map(decision.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const currentIds = () => [decision.selectedFlightCandidateId, decision.selectedHotelCandidateId, ...decision.selectedActivityCandidateIds].filter((id): id is string => Boolean(id));
  const rebuild = () => budgetLedger({
    payload: input.payload,
    selected: currentIds().map((id) => byId.get(id)).filter((candidate): candidate is GroundedCandidate => Boolean(candidate)),
    confirmedBookings: input.confirmedBookings,
    allowances: input.allowances
  });
  let ledger = rebuild();
  for (const category of ["flight", "hotel"] as const) {
    if (ledger.status !== "OVER_BUDGET") break;
    const currentId = category === "flight" ? decision.selectedFlightCandidateId : decision.selectedHotelCandidateId;
    const current = currentId ? byId.get(currentId) : null;
    const currentAmount = current ? candidateAmount(current) : null;
    const alternatives = decision.candidates.filter((candidate) => candidate.category === category && candidate.candidateId !== currentId && candidateAmount(candidate) !== null && (currentAmount === null || candidateAmount(candidate)! < currentAmount));
    const replacement = alternatives.sort((a, b) => candidateAmount(a)! - candidateAmount(b)!)[0];
    if (!replacement) continue;
    const savings = Math.max(0, (currentAmount || 0) - (candidateAmount(replacement) || 0));
    if (category === "flight") decision.selectedFlightCandidateId = replacement.candidateId;
    else decision.selectedHotelCandidateId = replacement.candidateId;
    decision.tradeoffOptions.push({ change: category, savings, candidateId: replacement.candidateId, description: `Switch to ${category} candidate ${replacement.candidateId} to reduce the known total.` });
    ledger = rebuild();
  }
  return { ...decision, budgetLedger: ledger };
}

export function candidateDecisionForAi(decision: GroundedDecision) {
  return {
    selectedFlight: decision.candidates.find((candidate) => candidate.candidateId === decision.selectedFlightCandidateId) || null,
    selectedHotel: decision.candidates.find((candidate) => candidate.candidateId === decision.selectedHotelCandidateId) || null,
    selectedActivities: decision.candidates.filter((candidate) => decision.selectedActivityCandidateIds.includes(candidate.candidateId)),
    recommendations: decision.recommendations,
    budgetLedger: decision.budgetLedger,
    unresolvedExactRequests: decision.unresolvedExactRequests,
    policy: "Only selected candidates may be stated as factual inventory. Other ideas are DISCOVERY_SUGGESTION with no invented price or availability."
  };
}
