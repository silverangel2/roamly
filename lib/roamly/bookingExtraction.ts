import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTripBooking, stableBookingKey, type TripBookingInput } from "@/lib/roamly/bookingWallet";
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
};

type TripMatchRecord = {
  id: string;
  user_id: string;
  title: string | null;
  destination: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  start_date: string | null;
  end_date: string | null;
};

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

function bookingTypeFromText(text: string, flightNumbers: string[]) {
  if (flightNumbers.length || /\b(flight|boarding|gate|terminal|airline)\b/i.test(text)) return "flight";
  if (/\b(hotel|room|property|check-?in|check-?out)\b/i.test(text)) return "hotel";
  if (/\b(train|rail)\b/i.test(text)) return "train";
  if (/\b(bus|coach)\b/i.test(text)) return "bus";
  if (/\b(ferry)\b/i.test(text)) return "ferry";
  if (/\b(rental car|car rental|pickup|pick-up)\b/i.test(text)) return "rental_car";
  if (/\b(restaurant|dinner|lunch reservation)\b/i.test(text)) return "restaurant";
  if (/\b(ticket|tour|activity|admission)\b/i.test(text)) return "activity";
  return "other";
}

function bookingStatusFromSubject(subject: string) {
  if (/\bcancel(?:led|lation)\b/i.test(subject)) return "cancelled";
  if (/\brefund(?:ed)?\b/i.test(subject)) return "refunded";
  if (/\b(modified|changed|updated|schedule change)\b/i.test(subject)) return "modified";
  return "confirmed";
}

export function deterministicBookingExtraction(params: {
  metadata: TravelEmailMetadata;
  filter: TravelEmailFilterResult;
}): StructuredBookingExtraction {
  const subject = clean(params.metadata.subject);
  const facts = params.filter.extractedFacts;
  const bookingReferences = asStringArray(facts.bookingReferenceCandidates);
  const flightNumbers = asStringArray(facts.flightNumbers);
  const dateHints = asStringArray(facts.dateHints);
  const provider = providerName(params.metadata, params.filter);
  const bookingType = bookingTypeFromText(`${subject} ${provider || ""}`, flightNumbers);
  const startTime = dateHintToIso(dateHints[0]);
  const confirmationCode = bookingReferences[0] || null;
  const flightNumber = flightNumbers[0] || null;
  const highSignal = Boolean(provider && confirmationCode && (flightNumber || startTime || bookingType === "hotel"));
  const overallConfidence = Math.min(1, params.filter.confidence + (highSignal ? 0.25 : 0) + (startTime ? 0.1 : 0));
  const title =
    bookingType === "flight" && flightNumber
      ? `Flight ${flightNumber}`
      : bookingType === "hotel" && provider
        ? `${provider} hotel booking`
        : subject || `${provider || "Travel"} booking`;
  const missingFields = [
    !confirmationCode ? "confirmation_code" : "",
    !startTime ? "start_time" : "",
    bookingType === "flight" && !flightNumber ? "flight_number" : ""
  ].filter(Boolean);

  return {
    extractionMethod: "deterministic",
    overallConfidence: Math.round(overallConfidence * 100) / 100,
    missingFields,
    matchReasons: params.filter.reasons,
    fields: {
      booking_type: field(bookingType, 0.75, "subject", "subject"),
      provider: field(provider, provider ? 0.7 : 0, "sender", "sender_domain", Boolean(provider)),
      confirmation_code: field(confirmationCode, confirmationCode ? 0.82 : 0, "filter_facts", "booking_reference", Boolean(confirmationCode)),
      start_time: field(startTime, startTime ? 0.62 : 0, "filter_facts", "date_hint"),
      flight_number: field(flightNumber, flightNumber ? 0.84 : 0, "filter_facts", "flight_number", Boolean(flightNumber)),
      title: field(title, 0.65, "subject", "subject")
    },
    booking: {
      bookingType,
      bookingStatus: overallConfidence >= 0.75 && missingFields.length === 0 ? bookingStatusFromSubject(subject) : "needs_confirmation",
      provider,
      confirmationCode,
      sourceType: "email",
      sourceReference: `email:${params.metadata.provider}:${params.metadata.messageId}`,
      title,
      startTime,
      flightNumber,
      travelerConfirmed: overallConfidence >= 0.75 && missingFields.length === 0,
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
          snippet: metadata.snippet || ""
        })
      }
    ]
  });
  const content = completion.choices[0]?.message?.content || "";
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const bookingType = clean(parsed.booking_type) || "other";
  const title = clean(parsed.title) || clean(metadata.subject) || "Travel booking";
  return {
    extractionMethod: "ai_structured" as const,
    overallConfidence: Math.max(0, Math.min(1, confidence)),
    missingFields: asStringArray(parsed.missing_fields),
    matchReasons: ["ai_structured_extraction"],
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
      bookingStatus: clean(parsed.booking_status) || "needs_confirmation",
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
  return destination
    .split(/\W+/)
    .filter((word) => word.length >= 4)
    .some((word) => bookingText.includes(word))
    ? 0.3
    : 0;
}

async function bestTripMatch(supabase: SupabaseClient, userId: string, extraction: StructuredBookingExtraction) {
  const { data } = await supabase
    .from("roamly_trips")
    .select("id,user_id,title,destination,destination_name,destination_city,start_date,end_date")
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("start_date", { ascending: true, nullsFirst: false })
    .limit(20);
  const trips = (data || []) as TripMatchRecord[];
  const scored = trips
    .map((trip) => ({
      trip,
      score: tripDateScore(trip, extraction.booking.startTime) + tripTextScore(trip, extraction) + (trips.length === 1 ? 0.1 : 0)
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score >= 0.4 ? best : null;
}

async function existingBookingByStableKey(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  booking: TripBookingInput;
}) {
  const key = stableBookingKey({
    userId: params.userId,
    provider: params.booking.provider,
    confirmationCode: params.booking.confirmationCode,
    bookingType: params.booking.bookingType,
    flightNumber: params.booking.flightNumber,
    startTime: params.booking.startTime,
    origin: params.booking.origin,
    destination: params.booking.destination,
    title: params.booking.title
  });
  const { data: bookings } = await params.supabase
    .from("roamly_bookings")
    .select("id,provider,confirmation_code,booking_type,flight_number,start_time,origin,destination,title")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .limit(50);
  return ((bookings || []) as Array<Record<string, unknown>>).find((booking) => {
    const candidateKey = stableBookingKey({
      userId: params.userId,
      provider: clean(booking.provider),
      confirmationCode: clean(booking.confirmation_code),
      bookingType: clean(booking.booking_type),
      flightNumber: clean(booking.flight_number),
      startTime: clean(booking.start_time),
      origin: clean(booking.origin),
      destination: clean(booking.destination),
      title: clean(booking.title)
    });
    return candidateKey === key;
  }) as { id: string } | undefined;
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
    match_reasons: params.matchReasons
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
      matchReasons: extraction.matchReasons
    });
    return { attached: false, status: "unmatched" as const, extraction };
  }

  const canAttach = extraction.overallConfidence >= 0.75 && extraction.missingFields.length === 0 && match.score >= 0.4;
  if (!canAttach) {
    await persistExtraction({
      supabase: writer,
      connection: params.connection,
      emailMessageId: params.emailMessageId || null,
      extraction,
      tripId: match.trip.id,
      matchedBookingId: null,
      matchStatus: "needs_confirmation",
      matchReasons: [...extraction.matchReasons, "uncertain_match"]
    });
    return { attached: false, status: "needs_confirmation" as const, tripId: match.trip.id, extraction };
  }

  const existing = await existingBookingByStableKey({
    supabase: writer,
    userId: params.connection.user_id,
    tripId: match.trip.id,
    booking: extraction.booking
  });
  let bookingId = existing?.id || null;
  if (!bookingId) {
    const saved = await createTripBooking({
      supabase: writer,
      userId: params.connection.user_id,
      tripId: match.trip.id,
      input: {
        ...extraction.booking,
        bookingStatus: extraction.booking.bookingStatus || "confirmed",
        travelerConfirmed: true
      }
    });
    bookingId = saved.booking?.id || null;
  }

  await persistExtraction({
    supabase: writer,
    connection: params.connection,
    emailMessageId: params.emailMessageId || null,
    extraction,
    tripId: match.trip.id,
    matchedBookingId: bookingId,
    matchStatus: "attached",
    matchReasons: [...extraction.matchReasons, "high_confidence_match"]
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
