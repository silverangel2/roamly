import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EmailConnectionRecord, EmailProvider } from "@/lib/roamly/emailConnections";

export type TravelEmailMetadata = {
  provider: EmailProvider;
  messageId: string;
  sender?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
};

export type TravelEmailFilterResult = {
  shouldProcess: boolean;
  processingResult: "ignored" | "filtered" | "relevant";
  confidence: number;
  reasons: string[];
  extractedFacts: Record<string, unknown>;
};

export const KNOWN_TRAVEL_DOMAINS = [
  "aircanada.com",
  "delta.com",
  "united.com",
  "aa.com",
  "southwest.com",
  "lufthansa.com",
  "airfrance.com",
  "britishairways.com",
  "klm.com",
  "emirates.com",
  "booking.com",
  "hotels.com",
  "expedia.com",
  "airbnb.com",
  "stay22.com",
  "aviasales.com",
  "travelpayouts.com",
  "trainline.com",
  "amtrak.com",
  "viarail.ca",
  "greyhound.com",
  "flixbus.com",
  "hertz.com",
  "avis.com",
  "enterprise.com",
  "rentalcars.com",
  "viator.com",
  "getyourguide.com",
  "klook.com",
  "ticketmaster.com",
  "tiqets.com",
  "headout.com",
  "opentable.com",
  "resy.com"
] as const;

const TRAVEL_SUBJECT_PATTERNS = [
  /booking confirmation/i,
  /reservation confirmed/i,
  /\bitinerary\b/i,
  /schedule change/i,
  /flight delayed/i,
  /flight cancelled/i,
  /cancelled flight/i,
  /delayed flight/i,
  /hotel modified/i,
  /hotel changed/i,
  /booking changed/i,
  /your booking has changed/i,
  /activity confirmation/i,
  /voucher/i,
  /ticket confirmation/i,
  /transport confirmation/i,
  /check-?in reminder/i,
  /cancellation confirmation/i,
  /gate (?:change|updated?)/i,
  /terminal (?:change|updated?)/i
];

const BOOKING_REFERENCE_PATTERN = /\b(?:confirmation|booking|reservation|record locator|pnr|voucher|order|reference)\s*(?:code|number|#)?\s*[:#-]?\s*([A-Z0-9-]{5,16})\b/gi;
const FLIGHT_NUMBER_PATTERN = /\b([A-Z]{2}\s?\d{1,4})\b/g;
const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi;
const TIME_PATTERN = /\b(\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)?|\d{1,2}\s?(?:AM|PM|am|pm))\b/g;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function senderDomain(sender?: string | null) {
  const value = clean(sender).toLowerCase();
  const email = value.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] || "";
  return email.replace(/^mail\./, "");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function filterTravelEmail(metadata: TravelEmailMetadata): TravelEmailFilterResult {
  const subject = clean(metadata.subject);
  const snippet = clean(metadata.snippet).slice(0, 600);
  const bodyText = clean(metadata.bodyText).slice(0, 5000);
  const searchable = `${subject} ${snippet} ${bodyText}`;
  const reasons: string[] = [];
  const facts: Record<string, unknown> = {};
  const domain = senderDomain(metadata.sender);

  if (domain && KNOWN_TRAVEL_DOMAINS.some((travelDomain) => domain === travelDomain || domain.endsWith(`.${travelDomain}`))) {
    reasons.push("known_travel_sender");
    facts.senderDomain = domain;
  }

  const subjectPattern = TRAVEL_SUBJECT_PATTERNS.find((pattern) => pattern.test(subject));
  if (subjectPattern) reasons.push("travel_subject");

  const bookingReferences = unique([...searchable.matchAll(BOOKING_REFERENCE_PATTERN)].map((match) => match[1].toUpperCase()));
  if (bookingReferences.length) {
    reasons.push("booking_reference");
    facts.bookingReferenceCandidates = bookingReferences.slice(0, 3);
  }

  const flightNumbers = unique([...searchable.matchAll(FLIGHT_NUMBER_PATTERN)].map((match) => match[1].replace(/\s+/g, "").toUpperCase()));
  if (flightNumbers.length) {
    reasons.push("flight_number");
    facts.flightNumbers = flightNumbers.slice(0, 4);
  }

  const dateHints = unique([...searchable.matchAll(DATE_PATTERN)].map((match) => match[1]));
  if (dateHints.length) {
    reasons.push("travel_date");
    facts.dateHints = dateHints.slice(0, 4);
  }

  const timeHints = unique([...searchable.matchAll(TIME_PATTERN)].map((match) => match[1]));
  if (timeHints.length) facts.timeHints = timeHints.slice(0, 4);

  const eventTypes = unique([
    /\bcancel(?:led|ed|lation)\b/i.test(searchable) ? "cancellation" : "",
    /\bdelay(?:ed)?\b/i.test(searchable) ? "delay" : "",
    /\b(gate|terminal)\s+(?:change|updated?)\b/i.test(searchable) ? "gate_or_terminal_change" : "",
    /\b(schedule|time|date)\s+(?:change|changed|updated|modified)\b/i.test(searchable) ? "schedule_change" : "",
    /\bconfirm(?:ed|ation)\b/i.test(searchable) ? "confirmation" : ""
  ]);
  if (eventTypes.length) {
    reasons.push("travel_event");
    facts.eventTypes = eventTypes;
  }

  const bookingTypes = unique([
    /\bflight|boarding|gate|terminal|airline\b/i.test(searchable) ? "flight" : "",
    /\bhotel|room|check-?in|check-?out|property\b/i.test(searchable) ? "hotel" : "",
    /\bklook|voucher|tour|activity|admission|ticket\b/i.test(searchable) ? "activity" : "",
    /\btrain|rail\b/i.test(searchable) ? "train" : "",
    /\bbus|coach\b/i.test(searchable) ? "bus" : "",
    /\btransfer|shuttle|ferry|rental car|car rental\b/i.test(searchable) ? "transport" : "",
    /\brestaurant|dinner|lunch reservation|opentable|resy\b/i.test(searchable) ? "restaurant" : ""
  ]);
  if (bookingTypes.length) facts.bookingTypes = bookingTypes;

  const travelLanguage = /\b(cancelled|canceled|delayed|confirmed|reservation|booking|boarding|check-?in|gate|terminal|hotel|flight|train|bus|rental car|voucher|ticket|tour|activity|transfer)\b/i.test(searchable);
  if (travelLanguage) reasons.push("travel_language");

  const score = Math.min(
    1,
    reasons.length * 0.18 +
      (reasons.includes("known_travel_sender") ? 0.25 : 0) +
      (bookingTypes.length ? 0.12 : 0) +
      (eventTypes.length ? 0.1 : 0)
  );
  const shouldProcess = score >= 0.35 || (bookingReferences.length > 0 && travelLanguage);

  return {
    shouldProcess,
    processingResult: shouldProcess ? "relevant" : reasons.length ? "filtered" : "ignored",
    confidence: Math.round(score * 100) / 100,
    reasons: unique(reasons),
    extractedFacts: {
      ...facts,
      subjectMatched: Boolean(subjectPattern),
      bodyStored: false
    }
  };
}

export async function recordTravelEmailFilterResult(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  metadata: TravelEmailMetadata;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const filter = filterTravelEmail(params.metadata);
  const payload = {
    user_id: params.connection.user_id,
    email_connection_id: params.connection.id,
    provider: params.metadata.provider,
    provider_message_id: clean(params.metadata.messageId),
    sender: clean(params.metadata.sender) || null,
    subject: clean(params.metadata.subject) || null,
    received_at: clean(params.metadata.receivedAt) || null,
    extracted_booking_facts: filter.extractedFacts,
    parser_confidence: filter.confidence,
    processing_result: filter.processingResult,
    filter_reasons: filter.reasons,
    raw_body_retained: false
  };

  if (!payload.provider_message_id) return { saved: false, filter, error: "MESSAGE_ID_MISSING" };

  const saved = await writer
    .from("travel_email_messages")
    .upsert(payload, {
      onConflict: "email_connection_id,provider,provider_message_id"
    })
    .select("id")
    .maybeSingle();

  return {
    saved: !saved.error,
    messageRecordId: (saved.data as { id?: string } | null)?.id || null,
    filter,
    error: saved.error?.message || null
  };
}
