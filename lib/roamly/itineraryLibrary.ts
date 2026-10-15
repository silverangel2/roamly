import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Itinerary Library front door — traveler-facing intake for sharing proven
 * itineraries and rating the booked items they actually used.
 *
 * Symmetry with ReviewIntel (Junel's words): "RI = order-proof reviews;
 * Roamly = booking-proof stays — verified experience, received, never scraped."
 * Every item verdict written through this module ties to the traveler's own
 * booking wallet (roamly_bookings / booking_segments), so booking_proven is
 * always true here.
 *
 * Fail-soft rule: the itinerary_submissions / item_verdicts tables may not
 * exist yet (migration is owner-applied). Every read treats a missing table
 * as "no data"; writes surface a clear TABLE_NOT_READY error instead of
 * crashing the caller.
 */

export type ItemVerdictInput = {
  /** booking_segments.id of the traveler's own booked segment (optional if bookingId given). */
  segmentId?: string | null;
  /** roamly_bookings.id of the traveler's own booking (optional if segmentId given). */
  bookingId?: string | null;
  itemType?: "hotel" | "flight" | "activity" | "other" | string | null;
  /** Snapshot label (e.g. "Fairmont Royal York — Toronto"). Required. */
  itemLabel?: string | null;
  location?: string | null;
  rating?: number | null;
  verdict?: "loved" | "fine" | "avoid" | string | null;
  note?: string | null;
};

export type ItinerarySubmissionInput = {
  tripId: string;
  title?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  highlights?: string | null;
  /** Explicit opt-in for anonymized reuse in Roamly suggestions. UI default: unchecked. */
  consentAnonymizedReuse: boolean;
  itemVerdicts: ItemVerdictInput[];
};

export type BookedSegmentOption = {
  segmentId: string | null;
  bookingId: string;
  itemType: "hotel" | "flight" | "activity" | "other";
  itemLabel: string;
  location: string | null;
  bookingTitle: string;
  provider: string | null;
};

export type CompletedTripOption = {
  id: string;
  title: string | null;
  destination: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type ItinerarySubmissionRecord = {
  id: string;
  trip_id: string;
  user_id: string;
  title: string | null;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  highlights: string | null;
  consent_anonymized_reuse: boolean;
  status: string | null;
  created_at: string;
};

export const ITINERARY_LIBRARY_TABLES_MISSING = "ITINERARY_LIBRARY_TABLES_NOT_READY";

function isMissingTableError(message: string) {
  return /schema cache|could not find the table|relation .* does not exist|42P01/i.test(message || "");
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function cleanRating(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

const ITEM_TYPES = new Set(["hotel", "flight", "activity", "other"]);
const VERDICTS = new Set(["loved", "fine", "avoid"]);

function cleanItemType(value: unknown): "hotel" | "flight" | "activity" | "other" {
  const normalized = cleanText(value, 20).toLowerCase();
  return ITEM_TYPES.has(normalized) ? (normalized as "hotel" | "flight" | "activity" | "other") : "other";
}

function cleanVerdict(value: unknown): "loved" | "fine" | "avoid" | null {
  const normalized = cleanText(value, 20).toLowerCase();
  return VERDICTS.has(normalized) ? (normalized as "loved" | "fine" | "avoid") : null;
}

function cleanDate(value: unknown): string | null {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()) ? text : null;
}

/**
 * Completed-trip gate for the library intake. Mirrors the trip page's terminal
 * state for the common case without pulling the live-companion chain:
 * the trip row must be status 'completed' and its end date must have passed.
 */
export function isTripCompletedForLibrary(params: {
  status?: unknown;
  endDate?: string | null;
  now?: string | Date;
}) {
  if (String(params.status || "").trim().toLowerCase() !== "completed") return false;
  const end = typeof params.endDate === "string" && params.endDate ? new Date(`${params.endDate.slice(0, 10)}T23:59:59Z`) : null;
  if (!end || Number.isNaN(end.getTime())) return false;
  const now = params.now ? new Date(params.now) : new Date();
  return end.getTime() <= now.getTime();
}

export function validateItinerarySubmissionInput(input: ItinerarySubmissionInput): {
  ok: boolean;
  error?: string;
} {
  if (!input || typeof input !== "object") return { ok: false, error: "INVALID_SUBMISSION" };
  if (!cleanText(input.tripId, 80)) return { ok: false, error: "TRIP_REQUIRED" };
  const destination = cleanText(input.destination, 200);
  if (!destination) return { ok: false, error: "DESTINATION_REQUIRED" };
  const startDate = cleanDate(input.startDate);
  const endDate = cleanDate(input.endDate);
  if (input.startDate && !startDate) return { ok: false, error: "INVALID_START_DATE" };
  if (input.endDate && !endDate) return { ok: false, error: "INVALID_END_DATE" };
  if (startDate && endDate && startDate > endDate) return { ok: false, error: "END_BEFORE_START" };
  if (typeof input.consentAnonymizedReuse !== "boolean") return { ok: false, error: "CONSENT_REQUIRED" };
  if (!Array.isArray(input.itemVerdicts)) return { ok: false, error: "INVALID_VERDICTS" };
  if (input.itemVerdicts.length > 60) return { ok: false, error: "TOO_MANY_VERDICTS" };

  for (const verdict of input.itemVerdicts) {
    if (!verdict || typeof verdict !== "object") return { ok: false, error: "INVALID_VERDICT" };
    const itemLabel = cleanText(verdict.itemLabel, 240);
    if (!itemLabel) return { ok: false, error: "VERDICT_LABEL_REQUIRED" };
    if (!verdict.segmentId && !verdict.bookingId) return { ok: false, error: "VERDICT_BOOKING_REF_REQUIRED" };
    if (verdict.rating != null && cleanRating(verdict.rating) == null) return { ok: false, error: "INVALID_RATING" };
    if (verdict.verdict != null && cleanVerdict(verdict.verdict) == null) return { ok: false, error: "INVALID_VERDICT_VALUE" };
  }

  return { ok: true };
}

function normalizeSubmissionInput(input: ItinerarySubmissionInput) {
  return {
    tripId: cleanText(input.tripId, 80),
    title: cleanText(input.title, 160) || null,
    destination: cleanText(input.destination, 200),
    startDate: cleanDate(input.startDate),
    endDate: cleanDate(input.endDate),
    highlights: cleanText(input.highlights, 4000) || null,
    consentAnonymizedReuse: input.consentAnonymizedReuse === true,
    itemVerdicts: input.itemVerdicts.map((verdict) => ({
      segmentId: cleanText(verdict.segmentId, 80) || null,
      bookingId: cleanText(verdict.bookingId, 80) || null,
      itemType: cleanItemType(verdict.itemType),
      itemLabel: cleanText(verdict.itemLabel, 240),
      location: cleanText(verdict.location, 160) || null,
      rating: cleanRating(verdict.rating),
      verdict: cleanVerdict(verdict.verdict),
      note: cleanText(verdict.note, 1000) || null
    }))
  };
}

/** The traveler's own completed trips, newest first — candidates for sharing. */
export async function getCompletedTripsForSharing(params: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ trips: CompletedTripOption[]; error: string | null }> {
  try {
    const { data, error } = await params.supabase
      .from("roamly_trips")
      .select("id,title,destination,destination_city,destination_country,start_date,end_date,status")
      .eq("user_id", params.userId)
      .eq("status", "completed")
      .order("end_date", { ascending: false })
      .limit(100);
    if (error) return { trips: [], error: error.message };
    const trips = (data || [])
      .filter((row) => isTripCompletedForLibrary({ status: (row as Record<string, unknown>).status, endDate: (row as Record<string, unknown>).end_date as string | null }))
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: String(record.id || ""),
          title: typeof record.title === "string" ? record.title : null,
          destination: typeof record.destination === "string" ? record.destination : null,
          destinationCity: typeof record.destination_city === "string" ? record.destination_city : null,
          destinationCountry: typeof record.destination_country === "string" ? record.destination_country : null,
          startDate: typeof record.start_date === "string" ? String(record.start_date).slice(0, 10) : null,
          endDate: typeof record.end_date === "string" ? String(record.end_date).slice(0, 10) : null
        } satisfies CompletedTripOption;
      })
      .filter((trip) => trip.id);
    return { trips, error: null };
  } catch (error) {
    return { trips: [], error: error instanceof Error ? error.message : "UNKNOWN" };
  }
}

function segmentLabel(segment: Record<string, unknown>, booking: Record<string, unknown>): string {
  const provider = typeof segment.provider === "string" && segment.provider.trim()
    ? segment.provider.trim()
    : typeof booking.provider_name === "string" && booking.provider_name.trim()
      ? booking.provider_name.trim()
      : "";
  const serviceNumber = typeof segment.service_number === "string" ? segment.service_number.trim() : "";
  const origin = typeof segment.origin === "string" ? segment.origin.trim() : "";
  const destination = typeof segment.destination === "string" ? segment.destination.trim() : "";
  const route = [origin, destination].filter(Boolean).join(" → ");
  const head = [provider, serviceNumber].filter(Boolean).join(" ");
  if (head && route) return `${head} · ${route}`;
  return head || route || (typeof booking.title === "string" && booking.title.trim() ? booking.title.trim() : "Booked item");
}

function bookingItemType(bookingType: unknown): "hotel" | "flight" | "activity" | "other" {
  const normalized = String(bookingType || "").trim().toLowerCase();
  if (normalized === "hotel" || normalized === "accommodation" || normalized === "lodging") return "hotel";
  if (normalized === "flight") return "flight";
  if (normalized === "activity" || normalized === "tour" || normalized === "experience") return "activity";
  return "other";
}

/**
 * The traveler's OWN booked segments for a trip — the dropdown source for the
 * share form. Each option ties a rating to a real booked item, so every
 * verdict written from it is booking-proof.
 */
export async function getTripBookedSegments(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}): Promise<{ segments: BookedSegmentOption[]; error: string | null }> {
  try {
    const { data, error } = await params.supabase
      .from("roamly_bookings")
      .select("id,title,provider_name,booking_type,booking_status,origin,destination,address,booking_segments(id,sequence,origin,destination,departure_time,arrival_time,provider,service_number)")
      .eq("user_id", params.userId)
      .eq("trip_id", params.tripId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return { segments: [], error: error.message };
    const options: BookedSegmentOption[] = [];
    for (const row of data || []) {
      const booking = row as Record<string, unknown>;
      const bookingId = String(booking.id || "");
      if (!bookingId) continue;
      const bookingTitle = typeof booking.title === "string" && booking.title.trim() ? booking.title.trim() : "Trip booking";
      const itemType = bookingItemType(booking.booking_type);
      const location = typeof booking.address === "string" && booking.address.trim()
        ? booking.address.trim()
        : [booking.origin, booking.destination].map((part) => (typeof part === "string" ? part.trim() : "")).filter(Boolean).join(" → ") || null;
      const segments = Array.isArray(booking.booking_segments) ? booking.booking_segments as Record<string, unknown>[] : [];
      if (!segments.length) {
        options.push({
          segmentId: null,
          bookingId,
          itemType,
          itemLabel: bookingTitle,
          location,
          bookingTitle,
          provider: typeof booking.provider_name === "string" ? booking.provider_name : null
        });
        continue;
      }
      for (const segment of segments) {
        const segmentId = typeof segment.id === "string" ? segment.id : null;
        options.push({
          segmentId,
          bookingId,
          itemType,
          itemLabel: segmentLabel(segment, booking),
          location,
          bookingTitle,
          provider: typeof booking.provider_name === "string" ? booking.provider_name : null
        });
      }
    }
    return { segments: options, error: null };
  } catch (error) {
    return { segments: [], error: error instanceof Error ? error.message : "UNKNOWN" };
  }
}

/** Existing submission for a trip, if any. Fail-soft: missing tables → null. */
export async function getItinerarySubmissionForTrip(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}): Promise<{ submission: ItinerarySubmissionRecord | null; error: string | null }> {
  try {
    const { data, error } = await params.supabase
      .from("itinerary_submissions")
      .select("id,trip_id,user_id,title,destination,start_date,end_date,highlights,consent_anonymized_reuse,status,created_at")
      .eq("user_id", params.userId)
      .eq("trip_id", params.tripId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error.message)) return { submission: null, error: null };
      return { submission: null, error: error.message };
    }
    if (!data) return { submission: null, error: null };
    const record = data as Record<string, unknown>;
    return {
      submission: {
        id: String(record.id || ""),
        trip_id: String(record.trip_id || ""),
        user_id: String(record.user_id || ""),
        title: typeof record.title === "string" ? record.title : null,
        destination: typeof record.destination === "string" ? record.destination : null,
        start_date: typeof record.start_date === "string" ? String(record.start_date).slice(0, 10) : null,
        end_date: typeof record.end_date === "string" ? String(record.end_date).slice(0, 10) : null,
        highlights: typeof record.highlights === "string" ? record.highlights : null,
        consent_anonymized_reuse: record.consent_anonymized_reuse === true,
        status: typeof record.status === "string" ? record.status : null,
        created_at: typeof record.created_at === "string" ? record.created_at : ""
      },
      error: null
    };
  } catch (error) {
    if (error instanceof Error && isMissingTableError(error.message)) return { submission: null, error: null };
    return { submission: null, error: error instanceof Error ? error.message : "UNKNOWN" };
  }
}

export async function submitItinerarySubmission(params: {
  supabase: SupabaseClient;
  userId: string;
  input: ItinerarySubmissionInput;
}): Promise<
  | { ok: true; submission: ItinerarySubmissionRecord; verdictsWritten: number }
  | { ok: false; error: string }
> {
  const validation = validateItinerarySubmissionInput(params.input);
  if (!validation.ok) return { ok: false, error: validation.error || "INVALID_SUBMISSION" };
  const normalized = normalizeSubmissionInput(params.input);

  // Trip must exist, belong to the traveler, and be completed.
  const trip = await params.supabase
    .from("roamly_trips")
    .select("id,status,start_date,end_date,destination,destination_city,destination_country")
    .eq("id", normalized.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (trip.error) return { ok: false, error: trip.error.message };
  if (!trip.data) return { ok: false, error: "TRIP_NOT_FOUND" };
  const tripRecord = trip.data as Record<string, unknown>;
  if (!isTripCompletedForLibrary({ status: tripRecord.status, endDate: tripRecord.end_date as string | null })) {
    return { ok: false, error: "TRIP_NOT_COMPLETED" };
  }

  // One submission per completed trip.
  const existing = await getItinerarySubmissionForTrip({ supabase: params.supabase, userId: params.userId, tripId: normalized.tripId });
  if (existing.error) return { ok: false, error: existing.error };
  if (existing.submission) return { ok: false, error: "ALREADY_SUBMITTED" };

  const destination = normalized.destination
    || (typeof tripRecord.destination_city === "string" && tripRecord.destination_city.trim() ? tripRecord.destination_city.trim() : "")
    || (typeof tripRecord.destination === "string" ? tripRecord.destination.trim() : "");

  const { data: submissionData, error: submissionError } = await params.supabase
    .from("itinerary_submissions")
    .insert({
      trip_id: normalized.tripId,
      user_id: params.userId,
      title: normalized.title,
      destination,
      destination_city: typeof tripRecord.destination_city === "string" ? tripRecord.destination_city : null,
      destination_country: typeof tripRecord.destination_country === "string" ? tripRecord.destination_country : null,
      start_date: normalized.startDate,
      end_date: normalized.endDate,
      highlights: normalized.highlights,
      consent_anonymized_reuse: normalized.consentAnonymizedReuse,
      anonymized: normalized.consentAnonymizedReuse,
      status: "received"
    })
    .select("id,trip_id,user_id,title,destination,start_date,end_date,highlights,consent_anonymized_reuse,status,created_at")
    .single();
  if (submissionError) {
    if (isMissingTableError(submissionError.message)) return { ok: false, error: ITINERARY_LIBRARY_TABLES_MISSING };
    if (/duplicate key|unique/i.test(submissionError.message)) return { ok: false, error: "ALREADY_SUBMITTED" };
    return { ok: false, error: submissionError.message };
  }

  const submissionRecord = submissionData as Record<string, unknown>;
  const submissionId = String(submissionRecord.id || "");
  const submission: ItinerarySubmissionRecord = {
    id: submissionId,
    trip_id: String(submissionRecord.trip_id || ""),
    user_id: String(submissionRecord.user_id || ""),
    title: typeof submissionRecord.title === "string" ? submissionRecord.title : null,
    destination: typeof submissionRecord.destination === "string" ? submissionRecord.destination : null,
    start_date: typeof submissionRecord.start_date === "string" ? String(submissionRecord.start_date).slice(0, 10) : null,
    end_date: typeof submissionRecord.end_date === "string" ? String(submissionRecord.end_date).slice(0, 10) : null,
    highlights: typeof submissionRecord.highlights === "string" ? submissionRecord.highlights : null,
    consent_anonymized_reuse: submissionRecord.consent_anonymized_reuse === true,
    status: typeof submissionRecord.status === "string" ? submissionRecord.status : null,
    created_at: typeof submissionRecord.created_at === "string" ? submissionRecord.created_at : ""
  };

  let verdictsWritten = 0;
  if (normalized.itemVerdicts.length) {
    const { error: verdictsError } = await params.supabase.from("item_verdicts").insert(
      normalized.itemVerdicts.map((verdict) => ({
        submission_id: submissionId,
        trip_id: normalized.tripId,
        user_id: params.userId,
        booking_id: verdict.bookingId,
        segment_id: verdict.segmentId,
        item_type: verdict.itemType,
        item_label: verdict.itemLabel,
        location: verdict.location,
        rating: verdict.rating,
        verdict: verdict.verdict,
        note: verdict.note,
        booking_proven: true,
        source: "gmail_booking"
      }))
    );
    if (verdictsError) {
      // Roll back the orphan submission so a retry starts clean.
      await params.supabase.from("itinerary_submissions").delete().eq("id", submissionId).eq("user_id", params.userId);
      return { ok: false, error: verdictsError.message };
    }
    verdictsWritten = normalized.itemVerdicts.length;
  }

  return { ok: true, submission, verdictsWritten };
}
