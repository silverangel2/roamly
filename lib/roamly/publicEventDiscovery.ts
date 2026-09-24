import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";

export type PublicEventSourceQuality =
  | "official_event"
  | "organizer"
  | "venue"
  | "tourism_board"
  | "municipal"
  | "museum_theatre"
  | "ticketing"
  | "credible_local"
  | "unknown";

export type PublicEventPriceStatus = "free" | "known" | "from_price" | "unknown";
export type PublicEventTicketStatus = "available" | "sold_out" | "unavailable" | "unknown";
export type PublicEventRecurrenceStatus = "single_occurrence" | "multi_day" | "recurring" | "unknown";
export type PublicEventTruthState = "CURRENT_VERIFIED" | "REVIEW_REQUIRED" | "HISTORICAL";

export type PublicEventTruth = {
  state: PublicEventTruthState;
  reason: "FRESH_EVIDENCE" | "MISSING_EXPIRY" | "MALFORMED_EXPIRY" | "EXPIRED_EVIDENCE" | "PAST_EVENT" | "PAST_EVENT_TIME" | "MISSING_EVENT_DATE" | "MALFORMED_EVENT_DATE" | "MALFORMED_EVENT_TIME" | "TIMEZONE_UNKNOWN";
  ticketStatus: PublicEventTicketStatus;
  priceStatus: PublicEventPriceStatus;
};

export type PublicEventCandidate = {
  eventCandidateId: string;
  sourceType: "public_web";
  sourceName: string;
  sourceUrl: string;
  sourceDomain: string;
  retrievedAt: string;
  title: string;
  summary?: string;
  destination: string;
  venue?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  timezone?: string;
  allDay?: boolean;
  categories: string[];
  price?: number;
  currency?: string;
  priceStatus: PublicEventPriceStatus;
  informationUrl: string;
  ticketUrl?: string;
  ticketStatus: PublicEventTicketStatus;
  ageRestriction?: string;
  sourceQuality: PublicEventSourceQuality;
  sourceConfidence: "high" | "medium" | "low";
  recurrenceStatus: PublicEventRecurrenceStatus;
  occurrenceEvidence: "exact_date" | "date_range" | "none";
};

export type PublicEventEvidenceInput = {
  sourceName?: unknown;
  sourceUrl?: unknown;
  sourceEventId?: unknown;
  retrievedAt?: unknown;
  title?: unknown;
  summary?: unknown;
  destination?: unknown;
  venue?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  startDate?: unknown;
  startTime?: unknown;
  endDate?: unknown;
  endTime?: unknown;
  timezone?: unknown;
  allDay?: unknown;
  categories?: unknown;
  price?: unknown;
  currency?: unknown;
  priceStatus?: unknown;
  ticketUrl?: unknown;
  ticketStatus?: unknown;
  ageRestriction?: unknown;
  sourceQuality?: unknown;
  sourceConfidence?: unknown;
  recurrenceStatus?: unknown;
  occurrenceEvidence?: unknown;
};

export type PublicEventTripContext = {
  destination: string;
  startDate: string;
  endDate: string;
  destinationTimezone?: string | null;
};

export type PublicEventEligibility =
  | { eligible: true; reason: "EXACT_DATE_OVERLAP" | "MULTI_DAY_OVERLAP" }
  | { eligible: false; reason: "INVALID_EVENT" | "WRONG_DESTINATION" | "OUTSIDE_TRIP" | "WEAK_SOURCE" | "OCCURRENCE_UNPROVEN" | "INVALID_CONTEXT" };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoDate(value: unknown) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? "" : raw;
}

function isoTimestamp(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function truthDate(value: unknown) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? null : raw;
}

function truthTime(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : null;
}

function validTimezone(value: unknown) {
  const timezone = text(value);
  if (!timezone) return "";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "";
  }
}

function localDateTimeToUtc(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(guess));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
    const rendered = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
    guess += Date.UTC(year, month - 1, day, hour, minute) - rendered;
  }
  return new Date(guess);
}

function localDateInTimezone(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function safeHttpUrl(value: unknown) {
  const raw = text(value);
  if (!raw || raw.startsWith("/") || /^javascript:|^data:/i.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password || url.port) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function sourceDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizedDestination(value: unknown) {
  return text(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16);
}

function eventIdentity(input: { sourceDomain: string; sourceUrl: string; title: string; startDate: string; endDate?: string; venue?: string; sourceEventId?: string }) {
  const stable = input.sourceEventId
    ? `${input.sourceDomain}|provider:${input.sourceEventId}`
    : [input.sourceDomain, input.sourceUrl, input.title.toLowerCase(), input.startDate, input.endDate || "", (input.venue || "").toLowerCase()].join("|");
  return `public-event:${hash(stable)}`;
}

function categoryList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).map((item) => item.toLowerCase()).filter(Boolean).slice(0, 8);
  return text(value).split(/[,|]/).map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, 8);
}

function allowedSourceQuality(value: unknown): PublicEventSourceQuality {
  const quality = text(value).toLowerCase();
  return ["official_event", "organizer", "venue", "tourism_board", "municipal", "museum_theatre", "ticketing", "credible_local"].includes(quality)
    ? quality as PublicEventSourceQuality
    : "unknown";
}

function priceStatus(value: unknown, price: number | null): PublicEventPriceStatus {
  const status = text(value).toLowerCase();
  if (status === "free" || status === "known" || status === "from_price") return status;
  return price == null ? "unknown" : "known";
}

function ticketStatus(value: unknown): PublicEventTicketStatus {
  const status = text(value).toLowerCase();
  return ["available", "sold_out", "unavailable"].includes(status) ? status as PublicEventTicketStatus : "unknown";
}

function recurrenceStatus(value: unknown): PublicEventRecurrenceStatus {
  const status = text(value).toLowerCase();
  return ["single_occurrence", "multi_day", "recurring"].includes(status) ? status as PublicEventRecurrenceStatus : "unknown";
}

export function normalizePublicEventEvidence(input: PublicEventEvidenceInput): PublicEventCandidate | null {
  const sourceUrl = safeHttpUrl(input.sourceUrl);
  const sourceName = text(input.sourceName);
  const title = text(input.title);
  const destination = text(input.destination);
  const retrievedAt = isoTimestamp(input.retrievedAt);
  const startDate = isoDate(input.startDate);
  const endDate = isoDate(input.endDate) || undefined;
  if (!sourceUrl || !sourceName || !title || !destination || !retrievedAt || !startDate) return null;
  if (endDate && endDate < startDate) return null;
  const ticketUrl = safeHttpUrl(input.ticketUrl);
  const price = finiteNumber(input.price);
  if (price != null && price < 0) return null;
  const quality = allowedSourceQuality(input.sourceQuality);
  const occurrenceEvidence = text(input.occurrenceEvidence).toLowerCase();
  const occurrence = occurrenceEvidence === "exact_date" || occurrenceEvidence === "date_range" ? occurrenceEvidence : "none";
  const sourceConfidence = ["high", "medium", "low"].includes(text(input.sourceConfidence).toLowerCase())
    ? text(input.sourceConfidence).toLowerCase() as "high" | "medium" | "low"
    : "low";
  return {
    eventCandidateId: eventIdentity({ sourceDomain: sourceDomain(sourceUrl), sourceUrl, title, startDate, endDate, venue: text(input.venue), sourceEventId: text(input.sourceEventId) || undefined }),
    sourceType: "public_web",
    sourceName,
    sourceUrl,
    sourceDomain: sourceDomain(sourceUrl),
    retrievedAt,
    title,
    summary: text(input.summary) || undefined,
    destination,
    venue: text(input.venue) || undefined,
    address: text(input.address) || undefined,
    latitude: finiteNumber(input.latitude) ?? undefined,
    longitude: finiteNumber(input.longitude) ?? undefined,
    startDate,
    startTime: text(input.startTime) || undefined,
    endDate,
    endTime: text(input.endTime) || undefined,
    timezone: text(input.timezone) || undefined,
    allDay: typeof input.allDay === "boolean" ? input.allDay : undefined,
    categories: categoryList(input.categories),
    price: price ?? undefined,
    currency: text(input.currency).toUpperCase() || undefined,
    priceStatus: priceStatus(input.priceStatus, price),
    informationUrl: sourceUrl,
    ticketUrl: ticketUrl || undefined,
    ticketStatus: ticketStatus(input.ticketStatus),
    ageRestriction: text(input.ageRestriction) || undefined,
    sourceQuality: quality,
    sourceConfidence,
    recurrenceStatus: recurrenceStatus(input.recurrenceStatus),
    occurrenceEvidence: occurrence
  };
}

export function evaluatePublicEventForTrip(event: PublicEventCandidate | null, context: PublicEventTripContext): PublicEventEligibility {
  const destination = normalizedDestination(context.destination);
  const eventDestination = normalizedDestination(event?.destination);
  const startDate = isoDate(context.startDate);
  const endDate = isoDate(context.endDate);
  if (!event || !destination || !startDate || !endDate || endDate < startDate) return { eligible: false, reason: "INVALID_CONTEXT" };
  if (event.sourceQuality === "unknown" || event.sourceConfidence === "low") return { eligible: false, reason: "WEAK_SOURCE" };
  if (event.recurrenceStatus === "recurring" && event.occurrenceEvidence === "none") return { eligible: false, reason: "OCCURRENCE_UNPROVEN" };
  if (!eventDestination || !eventDestination.includes(destination) && !destination.includes(eventDestination)) return { eligible: false, reason: "WRONG_DESTINATION" };
  const eventEnd = event.endDate || event.startDate;
  if (eventEnd < startDate || event.startDate > endDate) return { eligible: false, reason: "OUTSIDE_TRIP" };
  return { eligible: true, reason: event.endDate ? "MULTI_DAY_OVERLAP" : "EXACT_DATE_OVERLAP" };
}

export function evaluatePublicEventTruth(input: {
  source?: unknown;
  expiresAt?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  timezone?: unknown;
  destinationTimezone?: unknown;
  ticketStatus?: unknown;
  priceStatus?: unknown;
}, now = new Date()): PublicEventTruth {
  const ticket = ticketStatus(input.ticketStatus);
  const price = priceStatus(input.priceStatus, null);
  const start = truthDate(input.startDate);
  const end = truthDate(input.endDate) || start;
  if (!start) return { state: "REVIEW_REQUIRED", reason: "MISSING_EVENT_DATE", ticketStatus: ticket, priceStatus: price };
  if (input.endDate != null && text(input.endDate) && !truthDate(input.endDate)) {
    return { state: "REVIEW_REQUIRED", reason: "MALFORMED_EVENT_DATE", ticketStatus: ticket, priceStatus: price };
  }
  const timezone = validTimezone(input.timezone) || validTimezone(input.destinationTimezone);
  const today = timezone ? localDateInTimezone(now, timezone) : now.toISOString().slice(0, 10);
  if (end && end < today) return { state: "HISTORICAL", reason: "PAST_EVENT", ticketStatus: ticket, priceStatus: price };
  const rawStartTime = text(input.startTime);
  const rawEndTime = text(input.endTime);
  const startTime = rawStartTime ? truthTime(rawStartTime) : null;
  const endTime = rawEndTime ? truthTime(rawEndTime) : null;
  if ((rawStartTime && !startTime) || (rawEndTime && !endTime)) {
    return { state: "REVIEW_REQUIRED", reason: "MALFORMED_EVENT_TIME", ticketStatus: ticket, priceStatus: price };
  }
  if ((startTime || endTime) && !timezone) {
    return { state: "REVIEW_REQUIRED", reason: "TIMEZONE_UNKNOWN", ticketStatus: ticket, priceStatus: price };
  }
  if (timezone && endTime && end && end === today) {
    const eventEnd = localDateTimeToUtc(end, endTime, timezone);
    if (eventEnd.getTime() <= now.getTime()) {
      return { state: "HISTORICAL", reason: "PAST_EVENT_TIME", ticketStatus: ticket, priceStatus: price };
    }
  }
  const rawExpiry = text(input.expiresAt);
  if (!rawExpiry) return { state: "REVIEW_REQUIRED", reason: "MISSING_EXPIRY", ticketStatus: ticket, priceStatus: price };
  const expiry = new Date(rawExpiry);
  if (Number.isNaN(expiry.getTime())) return { state: "REVIEW_REQUIRED", reason: "MALFORMED_EXPIRY", ticketStatus: ticket, priceStatus: price };
  if (expiry.getTime() <= now.getTime()) return { state: "REVIEW_REQUIRED", reason: "EXPIRED_EVIDENCE", ticketStatus: ticket, priceStatus: price };
  return { state: "CURRENT_VERIFIED", reason: "FRESH_EVIDENCE", ticketStatus: ticket, priceStatus: price };
}

export function publicEventTruthForMarketResult(result: Pick<TravelMarketResult, "source" | "expires_at" | "start_date" | "end_date" | "metadata">, now = new Date(), destinationTimezone?: string | null) {
  const event = result.metadata?.public_event && typeof result.metadata.public_event === "object"
    ? result.metadata.public_event as Record<string, unknown>
    : {};
  return evaluatePublicEventTruth({
    source: result.source,
    expiresAt: result.expires_at,
    startDate: result.start_date || event.startDate,
    endDate: result.end_date || event.endDate,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone,
    destinationTimezone,
    ticketStatus: event.ticketStatus || result.metadata?.ticket_status,
    priceStatus: event.priceStatus || result.metadata?.price_status
  }, now);
}

export function dedupePublicEvents(events: PublicEventCandidate[]) {
  const seen = new Map<string, PublicEventCandidate>();
  for (const event of events) {
    const existing = seen.get(event.eventCandidateId);
    if (!existing) {
      seen.set(event.eventCandidateId, event);
      continue;
    }
    const conflicting = existing.startDate !== event.startDate || existing.endDate !== event.endDate || existing.venue !== event.venue || existing.sourceUrl !== event.sourceUrl;
    if (conflicting) seen.delete(event.eventCandidateId);
  }
  return Array.from(seen.values());
}

export function publicEventToMarketResult(event: PublicEventCandidate): TravelMarketResult {
  return {
    id: event.eventCandidateId,
    category: "attraction",
    title: event.title,
    provider: event.sourceName,
    source: "public_web",
    destination: event.destination,
    start_date: event.startDate,
    end_date: event.endDate,
    price_amount: event.price,
    currency: event.currency || "CAD",
    price_type: "unknown",
    confidence: event.sourceConfidence,
    normal_search_url: event.informationUrl,
    searched_at: event.retrievedAt,
    expires_at: event.retrievedAt,
    metadata: {
      public_event: event,
      source_url: event.informationUrl,
      source_domain: event.sourceDomain,
      ticket_url: event.ticketUrl || null,
      ticket_status: event.ticketStatus,
      price_status: event.priceStatus,
      occurrence_evidence: event.occurrenceEvidence,
      retrieval_provider: "firecrawl_fallback",
      verification_status: "public_event_evidence"
    }
  };
}
