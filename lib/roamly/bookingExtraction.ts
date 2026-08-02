import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTripBooking, type TripBookingInput } from "@/lib/roamly/bookingWallet";
import { reconcileTripBookings } from "@/lib/roamly/brain/bookingReconciliation";
import type { EmailConnectionRecord } from "@/lib/roamly/emailConnections";
import type { TravelEmailFilterResult, TravelEmailMetadata } from "@/lib/roamly/travelEmailFiltering";

export type ExtractedBookingField<T = string> = {
  value: T | null;
  confidence: number;
  source_type: "sender" | "subject" | "filter_facts" | "ai_structured";
  evidence_location: string;
  verified: boolean;
};

export type StructuredBookingExtraction = {
  booking: TripBookingInput;
  fields: Record<string, ExtractedBookingField>;
  extractionMethod: "deterministic" | "provider_specific" | "ai_structured";
  overallConfidence: number;
  missingFields: string[];
  matchReasons: string[];
  eventTypes: string[];
  requiresUserApproval: boolean;
};

export type TripMatchRecord = {
  id: string;
  user_id: string;
  title: string | null;
  destination: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  start_date: string | null;
  end_date: string | null;
};

const EMAIL_LOOKBACK_AUTO_APPLY_CONFIDENCE = 0.82;
const EMAIL_LOOKBACK_TRIP_MATCH_THRESHOLD = 0.7;
const EMAIL_LOOKBACK_TEXT_LIMIT = 6_000;

export const BOOKING_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["booking_type", "title", "provider", "confirmation_code", "start_time", "end_time", "origin", "destination", "confidence", "missing_fields"],
  properties: {
    booking_type: { type: "string", enum: ["flight", "hotel", "train", "bus", "ferry", "rental_car", "transfer", "activity", "restaurant", "insurance", "other"] },
    title: { type: "string" },
    provider: { type: "string" },
    confirmation_code: { type: "string" },
    start_time: { type: "string" },
    end_time: { type: "string" },
    origin: { type: "string" },
    destination: { type: "string" },
    flight_number: { type: "string" },
    hotel_name: { type: "string" },
    booking_status: { type: "string", enum: ["needs_confirmation", "confirmed", "modified", "cancelled", "refunded"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    missing_fields: { type: "array", items: { type: "string" } }
  }
} as const;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function field<T>(
  value: T | null,
  confidence: number,
  sourceType: ExtractedBookingField["source_type"],
  evidenceLocation: string,
  verified = false
): ExtractedBookingField<T> {
  return {
    value,
    confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)),
    source_type: sourceType,
    evidence_location: evidenceLocation,
    verified
  };
}

function senderDomain(sender?: string | null) {
  return clean(sender).toLowerCase().match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] || "";
}

function providerName(metadata: TravelEmailMetadata, filter: TravelEmailFilterResult) {
  const facts = filter.extractedFacts;
  const domain = clean(facts.senderDomain) || senderDomain(metadata.sender);
  if (!domain) return clean(metadata.sender) || null;
  return domain
    .replace(/^mail\./, "")
    .split(".")
    .slice(0, -1)
    .join(" ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateHintToIso(value?: string | null) {
  const text = clean(value);
  if (!text) return null;
  const dateOnly = text.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (dateOnly) return `${dateOnly}T00:00:00.000Z`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateTimeHintToIso(dateHint?: string | null, timeHint?: string | null) {
  const dateText = clean(dateHint);
  const timeText = clean(timeHint);
  if (!dateText) return null;
  const direct = dateHintToIso(timeText ? `${dateText} ${timeText}` : dateText);
  if (direct) return direct;
  return dateHintToIso(dateText);
}

function textFromMetadata(metadata: TravelEmailMetadata) {
  return [metadata.subject, metadata.snippet, metadata.bodyText].map(clean).filter(Boolean).join(" ").slice(0, EMAIL_LOOKBACK_TEXT_LIMIT);
}

function providerHintFromDomain(domain: string) {
  if (/klook\.com$/i.test(domain)) return { type: "activity", provider: "Klook" };
  if (/aircanada\.com$/i.test(domain)) return { type: "flight", provider: "Air Canada" };
  if (/delta\.com$/i.test(domain)) return { type: "flight", provider: "Delta" };
  if (/united\.com$/i.test(domain)) return { type: "flight", provider: "United Airlines" };
  if (/aa\.com$/i.test(domain)) return { type: "flight", provider: "American Airlines" };
  if (/booking\.com$|hotels\.com$|expedia\.com$|stay22\.com$/i.test(domain)) return { type: "hotel", provider: null };
  if (/trainline\.com$|amtrak\.com$|viarail\.ca$/i.test(domain)) return { type: "train", provider: null };
  if (/greyhound\.com$|flixbus\.com$/i.test(domain)) return { type: "bus", provider: null };
  return { type: "", provider: null };
}

function bookingTypeFromText(text: string, flightNumbers: string[], bookingTypes: string[], domain: string) {
  const providerHint = providerHintFromDomain(domain);
  if (providerHint.type) return providerHint.type;
  if (bookingTypes.includes("flight") || flightNumbers.length || /\b(flight|boarding|gate|terminal|airline)\b/i.test(text)) return "flight";
  if (bookingTypes.includes("hotel")) return "hotel";
  if (bookingTypes.includes("activity")) return "activity";
  if (bookingTypes.includes("train")) return "train";
  if (bookingTypes.includes("bus")) return "bus";
  if (bookingTypes.includes("restaurant")) return "restaurant";
  if (bookingTypes.includes("transport")) return "transfer";
  if (/\b(hotel|room|property|check-?in|check-?out)\b/i.test(text)) return "hotel";
  if (/\b(train|rail)\b/i.test(text)) return "train";
  if (/\b(bus|coach)\b/i.test(text)) return "bus";
  if (/\b(ferry)\b/i.test(text)) return "ferry";
  if (/\b(rental car|car rental|pickup|pick-up)\b/i.test(text)) return "rental_car";
  if (/\b(transfer|shuttle|airport pickup|private car)\b/i.test(text)) return "transfer";
  if (/\b(restaurant|dinner|lunch reservation)\b/i.test(text)) return "restaurant";
  if (/\b(klook|voucher|ticket|tour|activity|admission)\b/i.test(text)) return "activity";
  return "other";
}

function bookingStatusFromText(text: string) {
  if (/\bcancel(?:led|ed|lation)\b/i.test(text)) return "cancelled";
  if (/\brefund(?:ed)?\b/i.test(text)) return "refunded";
  if (/\b(modified|changed|updated|schedule change|time change|date change|hotel changed|booking changed)\b/i.test(text)) return "modified";
  return "confirmed";
}

function inferredEventTypes(text: string, facts: Record<string, unknown>) {
  return [
    ...asStringArray(facts.eventTypes),
    /\bcancel(?:led|ed|lation)\b/i.test(text) ? "cancellation" : "",
    /\bdelay(?:ed)?\b/i.test(text) ? "delay" : "",
    /\b(gate|terminal)\s+(?:change|updated?)\b/i.test(text) ? "gate_or_terminal_change" : "",
    /\b(schedule|time|date|hotel|booking)\s+(?:change|changed|updated|modified)\b/i.test(text) ? "schedule_change" : ""
  ].filter(Boolean);
}

function requiresApprovalForEvent(eventTypes: string[], bookingType: string, status: string) {
  if (status === "cancelled" || status === "refunded") return true;
  if (eventTypes.some((event) => event === "cancellation" || event === "schedule_change")) return true;
  return bookingType === "hotel" && status === "modified";
}

function extractNamedValue(text: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`\\b${label}\\s*[:#-]?\\s*([^\\n\\r|]{3,80})`, "i");
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\s{2,}.*/, "").trim();
  }
  return "";
}

function cleanLocationValue(value: string) {
  return clean(value)
    .replace(/\s+\b(?:on|at|departing|arriving|arrival|departure|date|time)\b.*$/i, "")
    .replace(/[.;|].*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractRouteFromText(text: string) {
  const direct = text.match(/\bfrom\s+([A-Z][A-Za-z .,'-]{2,70})\s+to\s+([A-Z][A-Za-z .,'-]{2,70})(?:\s+\b(?:on|at|departing|arriving)\b|[.;|]|$)/i);
  if (direct) {
    return {
      origin: cleanLocationValue(direct[1]),
      destination: cleanLocationValue(direct[2])
    };
  }
  const toOnly = text.match(/\b(?:flight|train|bus|transfer|shuttle|ferry)\s+[A-Z0-9 -]{0,12}\s+to\s+([A-Z][A-Za-z .,'-]{2,70})(?:\s+\b(?:on|at|departing|arriving)\b|[.;|]|$)/i);
  return {
    origin: "",
    destination: toOnly ? cleanLocationValue(toOnly[1]) : ""
  };
}

export function deterministicBookingExtraction(params: {
  metadata: TravelEmailMetadata;
  filter: TravelEmailFilterResult;
}): StructuredBookingExtraction {
  const subject = clean(params.metadata.subject);
  const searchable = textFromMetadata(params.metadata);
  const facts = params.filter.extractedFacts;
  const bookingReferences = asStringArray(facts.bookingReferenceCandidates);
  const flightNumbers = asStringArray(facts.flightNumbers);
  const dateHints = asStringArray(facts.dateHints);
  const timeHints = asStringArray(facts.timeHints);
  const bookingTypes = asStringArray(facts.bookingTypes);
  const domain = senderDomain(params.metadata.sender);
  const providerHint = providerHintFromDomain(domain);
  const provider = providerHint.provider || providerName(params.metadata, params.filter);
  const bookingType = bookingTypeFromText(`${searchable} ${provider || ""}`, flightNumbers, bookingTypes, domain);
  const startTime = dateTimeHintToIso(dateHints[0], timeHints[0]);
  const confirmationCode = bookingReferences[0] || null;
  const flightNumber = flightNumbers[0] || null;
  const status = bookingStatusFromText(searchable || subject);
  const eventTypes = [...new Set(inferredEventTypes(searchable || subject, facts))];
  const highSignal = Boolean(provider && confirmationCode && (flightNumber || startTime || bookingType === "hotel" || bookingType === "activity"));
  const overallConfidence = Math.min(
    1,
    params.filter.confidence +
      (highSignal ? 0.25 : 0) +
      (startTime ? 0.1 : 0) +
      (eventTypes.length ? 0.05 : 0)
  );
  const hotelName = extractNamedValue(searchable, ["hotel", "property", "accommodation"]);
  const activityName = extractNamedValue(searchable, ["activity", "experience", "tour", "ticket", "voucher"]);
  const route = extractRouteFromText(searchable);
  const originName =
    cleanLocationValue(extractNamedValue(searchable, ["origin", "departure city", "departure", "pickup", "pick-up"])) ||
    route.origin ||
    null;
  const destinationName =
    cleanLocationValue(extractNamedValue(searchable, ["destination", "arrival city", "arrival", "dropoff", "drop-off"])) ||
    route.destination ||
    null;
  const title =
    bookingType === "flight" && flightNumber
      ? `Flight ${flightNumber}`
      : bookingType === "activity" && activityName
        ? activityName
      : bookingType === "hotel" && provider
        ? `${hotelName || provider} hotel booking`
        : subject || `${provider || "Travel"} booking`;
  const missingFields = [
    !confirmationCode ? "confirmation_code" : "",
    !startTime && status === "confirmed" ? "start_time" : "",
    bookingType === "flight" && !flightNumber ? "flight_number" : ""
  ].filter(Boolean);
  const requiresUserApproval = requiresApprovalForEvent(eventTypes, bookingType, status);

  return {
    extractionMethod: "deterministic",
    overallConfidence: Math.round(overallConfidence * 100) / 100,
    missingFields,
    matchReasons: [...params.filter.reasons, ...eventTypes.map((event) => `event:${event}`)],
    eventTypes,
    requiresUserApproval,
    fields: {
      booking_type: field(bookingType, 0.75, "subject", "subject"),
      provider: field(provider, provider ? 0.7 : 0, "sender", "sender_domain", Boolean(provider)),
      confirmation_code: field(confirmationCode, confirmationCode ? 0.82 : 0, "filter_facts", "booking_reference", Boolean(confirmationCode)),
      start_time: field(startTime, startTime ? 0.62 : 0, "filter_facts", "date_hint"),
      flight_number: field(flightNumber, flightNumber ? 0.84 : 0, "filter_facts", "flight_number", Boolean(flightNumber)),
      origin: field(originName, originName ? 0.58 : 0, "filter_facts", "body_preview", Boolean(originName)),
      destination: field(destinationName, destinationName ? 0.58 : 0, "filter_facts", "body_preview", Boolean(destinationName)),
      title: field(title, 0.65, "subject", "subject")
    },
    booking: {
      bookingType,
      bookingStatus: overallConfidence >= EMAIL_LOOKBACK_AUTO_APPLY_CONFIDENCE && missingFields.length === 0 ? status : "needs_confirmation",
      provider,
      confirmationCode,
      sourceType: "email",
      sourceReference: `email:${params.metadata.provider}:${params.metadata.messageId}`,
      title,
      startTime,
      origin: originName,
      destination: destinationName,
      locationName: bookingType === "hotel" ? hotelName || null : bookingType === "activity" ? activityName || null : null,
      flightNumber,
      travelerConfirmed: overallConfidence >= EMAIL_LOOKBACK_AUTO_APPLY_CONFIDENCE && missingFields.length === 0,
      lastSyncedAt: new Date().toISOString()
    }
  };
}

function aiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

export async function extractBookingWithAiStructuredOutput(metadata: TravelEmailMetadata) {
  const client = aiClient();
  if (!client) return null;
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_BOOKING_EXTRACTION_MODEL || "gpt-4o-mini",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "roamly_booking_extraction",
        schema: BOOKING_EXTRACTION_JSON_SCHEMA,
        strict: true
      }
    },
    messages: [
      {
        role: "system",
        content:
          "Extract only travel booking facts from the supplied email metadata. Return strict JSON. Do not infer missing booking facts, prices, live status, or availability."
      },
      {
        role: "user",
        content: JSON.stringify({
          sender: metadata.sender || "",
          subject: metadata.subject || "",
          snippet: metadata.snippet || "",
          body_preview: clean(metadata.bodyText).slice(0, EMAIL_LOOKBACK_TEXT_LIMIT)
        })
      }
    ]
  });
  const content = completion.choices[0]?.message?.content || "";
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const bookingType = clean(parsed.booking_type) || "other";
  const title = clean(parsed.title) || clean(metadata.subject) || "Travel booking";
  const bookingStatus = clean(parsed.booking_status) || "needs_confirmation";
  const eventTypes = inferredEventTypes(textFromMetadata(metadata), {});
  return {
    extractionMethod: "ai_structured" as const,
    overallConfidence: Math.max(0, Math.min(1, confidence)),
    missingFields: asStringArray(parsed.missing_fields),
    matchReasons: ["ai_structured_extraction"],
    eventTypes,
    requiresUserApproval: requiresApprovalForEvent(eventTypes, bookingType, bookingStatus),
    fields: {
      booking_type: field(bookingType, confidence, "ai_structured", "structured_output"),
      provider: field(clean(parsed.provider) || null, confidence, "ai_structured", "structured_output"),
      confirmation_code: field(clean(parsed.confirmation_code) || null, confidence, "ai_structured", "structured_output"),
      start_time: field(dateHintToIso(clean(parsed.start_time)) || null, confidence, "ai_structured", "structured_output"),
      flight_number: field(clean(parsed.flight_number) || null, confidence, "ai_structured", "structured_output"),
      title: field(title, confidence, "ai_structured", "structured_output")
    },
    booking: {
      bookingType,
      bookingStatus,
      provider: clean(parsed.provider) || null,
      confirmationCode: clean(parsed.confirmation_code) || null,
      sourceType: "email",
      sourceReference: `email:${metadata.provider}:${metadata.messageId}`,
      title,
      startTime: dateHintToIso(clean(parsed.start_time)),
      endTime: dateHintToIso(clean(parsed.end_time)),
      origin: clean(parsed.origin) || null,
      destination: clean(parsed.destination) || null,
      flightNumber: clean(parsed.flight_number) || null,
      locationName: clean(parsed.hotel_name) || null,
      travelerConfirmed: confidence >= 0.82 && clean(parsed.confirmation_code) !== "",
      lastSyncedAt: new Date().toISOString()
    }
  } satisfies StructuredBookingExtraction;
}

function tripDateScore(trip: TripMatchRecord, startTime?: string | null) {
  if (!trip.start_date || !startTime) return 0;
  const date = new Date(startTime);
  const start = new Date(`${trip.start_date}T00:00:00.000Z`);
  const end = new Date(`${trip.end_date || trip.start_date}T23:59:59.000Z`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  return date.getTime() >= start.getTime() - twoDays && date.getTime() <= end.getTime() + twoDays ? 0.5 : 0;
}

function tripTextScore(trip: TripMatchRecord, extraction: StructuredBookingExtraction) {
  const destination = [trip.destination, trip.destination_name, trip.destination_city, trip.title].map(clean).filter(Boolean).join(" ").toLowerCase();
  const bookingText = [extraction.booking.destination, extraction.booking.locationName, extraction.booking.title].map(clean).filter(Boolean).join(" ").toLowerCase();
  if (!destination || !bookingText) return 0;
  const matched = destination
    .split(/\W+/)
    .filter((word) => word.length >= 4)
    .some((word) => bookingText.includes(word))
  return matched ? 0.3 : 0;
}

export function scoreTripForEmailLookbackMatch(
  trip: TripMatchRecord,
  extraction: StructuredBookingExtraction,
  tripCount = 1
) {
  const dateScore = tripDateScore(trip, extraction.booking.startTime);
  const textScore = tripTextScore(trip, extraction);
  const singleTripBonus = tripCount === 1 && dateScore > 0 && extraction.overallConfidence >= 0.9 ? 0.1 : 0;
  return {
    trip,
    score: dateScore + textScore + singleTripBonus,
    reasons: [
      dateScore ? "trip_date_overlap" : "",
      textScore ? "destination_text_match" : "",
      singleTripBonus ? "single_trip_date_window" : ""
    ].filter(Boolean)
  };
}

export function shouldAutoApplyEmailLookbackExtraction(params: {
  extraction: StructuredBookingExtraction;
  matchScore: number;
}) {
  return (
    params.extraction.overallConfidence >= EMAIL_LOOKBACK_AUTO_APPLY_CONFIDENCE &&
    params.extraction.missingFields.length === 0 &&
    params.matchScore >= EMAIL_LOOKBACK_TRIP_MATCH_THRESHOLD &&
    !params.extraction.requiresUserApproval
  );
}

async function existingBookingTripMatch(supabase: SupabaseClient, userId: string, extraction: StructuredBookingExtraction) {
  const confirmation = clean(extraction.booking.confirmationCode);
  const providerBookingId = clean(extraction.booking.providerBookingId);
  const flightNumber = clean(extraction.booking.flightNumber);
  const startTime = clean(extraction.booking.startTime);

  async function lookup(column: string, value: string) {
    if (!value) return null;
    const { data } = await supabase
      .from("roamly_bookings")
      .select("id,trip_id,user_id,title,booking_type,confirmation_number,provider_booking_id,flight_number,start_at")
      .eq("user_id", userId)
      .eq(column, value)
      .order("updated_at", { ascending: false })
      .limit(3);
    return (data || [])[0] as Record<string, unknown> | undefined;
  }

  const direct =
    (await lookup("confirmation_number", confirmation)) ||
    (await lookup("provider_booking_id", providerBookingId));
  if (direct?.trip_id) {
    return {
      tripId: String(direct.trip_id),
      bookingId: String(direct.id),
      score: 1,
      reasons: ["exact_existing_booking_match"]
    };
  }

  const startMs = startTime ? new Date(startTime).getTime() : NaN;
  if (flightNumber && Number.isFinite(startMs)) {
    const { data } = await supabase
      .from("roamly_bookings")
      .select("id,trip_id,user_id,title,booking_type,flight_number,start_at")
      .eq("user_id", userId)
      .eq("flight_number", flightNumber)
      .gte("start_at", new Date(startMs - 12 * 60 * 60 * 1000).toISOString())
      .lte("start_at", new Date(startMs + 12 * 60 * 60 * 1000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(1);
    const row = (data || [])[0] as Record<string, unknown> | undefined;
    if (row?.trip_id) {
      return {
        tripId: String(row.trip_id),
        bookingId: String(row.id),
        score: 0.95,
        reasons: ["flight_number_time_existing_booking_match"]
      };
    }
  }

  return null;
}

async function bestTripMatch(supabase: SupabaseClient, userId: string, extraction: StructuredBookingExtraction) {
  const existing = await existingBookingTripMatch(supabase, userId, extraction).catch(() => null);
  const { data } = await supabase
    .from("roamly_trips")
    .select("id,user_id,title,destination,destination_name,destination_city,start_date,end_date")
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("start_date", { ascending: true, nullsFirst: false })
    .limit(20);
  const trips = (data || []) as TripMatchRecord[];
  if (existing) {
    const trip = trips.find((candidate) => candidate.id === existing.tripId);
    if (trip) return { trip, score: existing.score, reasons: existing.reasons, existingBookingId: existing.bookingId };
  }
  const scored = trips
    .map((trip) => scoreTripForEmailLookbackMatch(trip, extraction, trips.length))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < EMAIL_LOOKBACK_TRIP_MATCH_THRESHOLD) return null;
  if (!best.reasons.includes("trip_date_overlap")) return null;
  if (!best.reasons.includes("destination_text_match") && !best.reasons.includes("single_trip_date_window")) return null;
  return best;
}

async function persistExtraction(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  emailMessageId: string | null;
  extraction: StructuredBookingExtraction;
  tripId: string | null;
  matchedBookingId: string | null;
  matchStatus: "unmatched" | "attached" | "needs_confirmation";
  matchReasons: string[];
  autoApplyAllowed?: boolean;
  requiresUserApproval?: boolean;
  appliedAt?: string | null;
}) {
  const payload = {
    user_id: params.connection.user_id,
    trip_id: params.tripId,
    email_message_id: params.emailMessageId,
    source_type: "email",
    source_reference: params.extraction.booking.sourceReference || null,
    extraction_method: params.extraction.extractionMethod,
    extracted_booking_json: params.extraction.booking,
    field_confidence_json: params.extraction.fields,
    overall_confidence: params.extraction.overallConfidence,
    match_status: params.matchStatus,
    matched_booking_id: params.matchedBookingId,
    match_reasons: params.matchReasons,
    email_event_types: params.extraction.eventTypes,
    auto_apply_allowed: params.autoApplyAllowed === true,
    requires_user_approval: params.requiresUserApproval === true,
    applied_at: params.appliedAt || null,
    idempotency_key: [
      params.connection.user_id,
      params.extraction.booking.sourceReference,
      params.tripId || "unmatched",
      params.matchedBookingId || "pending"
    ].filter(Boolean).join(":")
  };
  await params.supabase.from("booking_extraction_results").upsert(payload, {
    onConflict: "user_id,source_type,source_reference"
  });
}

export async function extractAndMatchTravelEmailBooking(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  metadata: TravelEmailMetadata;
  filter: TravelEmailFilterResult;
  emailMessageId?: string | null;
}) {
  if (!params.filter.shouldProcess) return { attached: false, status: "ignored" as const };
  const writer = createSupabaseAdminClient() || params.supabase;
  const deterministic = deterministicBookingExtraction({ metadata: params.metadata, filter: params.filter });
  const aiExtraction =
    deterministic.overallConfidence < 0.45
      ? await extractBookingWithAiStructuredOutput(params.metadata).catch(() => null)
      : null;
  const extraction = aiExtraction && aiExtraction.overallConfidence > deterministic.overallConfidence ? aiExtraction : deterministic;
  const match = await bestTripMatch(writer, params.connection.user_id, extraction);
  if (!match) {
    await persistExtraction({
      supabase: writer,
      connection: params.connection,
      emailMessageId: params.emailMessageId || null,
      extraction,
      tripId: null,
      matchedBookingId: null,
      matchStatus: "unmatched",
      matchReasons: extraction.matchReasons,
      requiresUserApproval: extraction.requiresUserApproval
    });
    return { attached: false, status: "unmatched" as const, extraction };
  }

  const matchReasons = Array.isArray(match.reasons) ? match.reasons : [];
  const existingBookingId = "existingBookingId" in match ? match.existingBookingId || null : null;
  const canAttach = shouldAutoApplyEmailLookbackExtraction({
    extraction,
    matchScore: match.score
  });
  if (!canAttach) {
    await persistExtraction({
      supabase: writer,
      connection: params.connection,
      emailMessageId: params.emailMessageId || null,
      extraction,
      tripId: match.trip.id,
      matchedBookingId: existingBookingId,
      matchStatus: "needs_confirmation",
      matchReasons: [...extraction.matchReasons, ...matchReasons, extraction.requiresUserApproval ? "requires_user_approval" : "uncertain_match"],
      requiresUserApproval: extraction.requiresUserApproval
    });
    return { attached: false, status: "needs_confirmation" as const, tripId: match.trip.id, extraction };
  }

  const emailSource =
    params.connection.provider === "gmail"
      ? "gmail"
      : params.connection.provider === "outlook"
        ? "outlook"
        : "email";
  const existingReservationRequirements =
    "reservationRequirements" in extraction.booking &&
    extraction.booking.reservationRequirements &&
    typeof extraction.booking.reservationRequirements === "object" &&
    !Array.isArray(extraction.booking.reservationRequirements)
      ? extraction.booking.reservationRequirements
      : {};

  const saved = await createTripBooking({
    supabase: writer,
    userId: params.connection.user_id,
    tripId: match.trip.id,
    input: {
      ...extraction.booking,
      sourceType: emailSource,
      sourceReference:
        extraction.booking.sourceReference ||
        params.metadata.messageId ||
        params.emailMessageId ||
        null,
      bookingStatus:
        extraction.booking.bookingStatus ||
        "confirmed",
      travelerConfirmed: true,
      reservationRequirements: {
        ...existingReservationRequirements,
        email_lookback: {
          event_types: extraction.eventTypes,
          requires_user_approval: extraction.requiresUserApproval,
          matched_existing_booking_id: existingBookingId,
          retrieval_timestamp: new Date().toISOString()
        }
      },
      lastSyncedAt: new Date().toISOString()
    }
  });

  const bookingId = saved.booking?.id || null;

  if (saved.error) {
    await persistExtraction({
      supabase: writer,
      connection: params.connection,
      emailMessageId: params.emailMessageId || null,
      extraction,
      tripId: match.trip.id,
      matchedBookingId: null,
      matchStatus: "needs_confirmation",
      matchReasons: [
        ...extraction.matchReasons,
        ...matchReasons,
        "booking_save_failed",
        saved.error
      ],
      autoApplyAllowed: true,
      requiresUserApproval: extraction.requiresUserApproval
    });

    return {
      attached: false,
      status: "needs_confirmation" as const,
      tripId: match.trip.id,
      extraction,
      error: saved.error
    };
  }

  await persistExtraction({
    supabase: writer,
    connection: params.connection,
    emailMessageId: params.emailMessageId || null,
    extraction,
    tripId: match.trip.id,
    matchedBookingId: bookingId,
    matchStatus: "attached",
    matchReasons: [...extraction.matchReasons, ...matchReasons, "high_confidence_match"],
    autoApplyAllowed: true,
    requiresUserApproval: extraction.requiresUserApproval,
    appliedAt: bookingId ? new Date().toISOString() : null
  });
  if (bookingId) {
    await reconcileTripBookings({
      supabase: writer,
      userId: params.connection.user_id,
      tripId: match.trip.id,
      sourceBookingId: bookingId
    }).catch(() => null);
  }
  return { attached: Boolean(bookingId), status: "attached" as const, tripId: match.trip.id, bookingId, extraction };
}
