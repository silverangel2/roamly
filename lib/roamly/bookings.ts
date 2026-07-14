import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordTripEvent } from "@/lib/roamly/events";
import { createTripBooking } from "@/lib/roamly/bookingWallet";

export type RoamlyBookingType =
  | "flight"
  | "hotel"
  | "attraction"
  | "restaurant"
  | "transport"
  | "car_rental"
  | "event"
  | "other";

export type ExtractedBooking = {
  booking_type: RoamlyBookingType;
  provider_name: string;
  title: string;
  confirmation_number: string;
  booking_status: "booked" | "paid" | "reserved" | "cancelled" | "unknown";
  amount_cents: number | null;
  currency: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  address: string;
  city: string;
  region: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  raw_extracted_text: string;
  extraction_confidence: "low" | "medium" | "high";
  metadata: Record<string, unknown>;
};

const bookingTypes = new Set<RoamlyBookingType>([
  "flight",
  "hotel",
  "attraction",
  "restaurant",
  "transport",
  "car_rental",
  "event",
  "other"
]);

const statuses = new Set(["booked", "paid", "reserved", "cancelled", "unknown"]);
const confidenceValues = new Set(["low", "medium", "high"]);

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function asText(value: unknown) {
  return typeof value === "string" ? redactSensitivePaymentDetails(value.trim()) : "";
}

function asNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asAmountCents(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1000 ? Math.round(value) : Math.round(value * 100);
  }
  return null;
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

export function redactSensitivePaymentDetails(value: string) {
  return value
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted card number]")
    .replace(/\b(?:cvv|cvc|security code)\s*:?\s*\d{3,4}\b/gi, "[redacted security code]");
}

export function normalizeExtractedBooking(value: Record<string, unknown>): ExtractedBooking {
  const bookingType = asText(value.booking_type);
  const bookingStatus = asText(value.booking_status);
  const confidence = asText(value.extraction_confidence);

  return {
    booking_type: bookingTypes.has(bookingType as RoamlyBookingType) ? (bookingType as RoamlyBookingType) : "other",
    provider_name: asText(value.provider_name),
    title: asText(value.title) || "Imported booking",
    confirmation_number: asText(value.confirmation_number),
    booking_status: statuses.has(bookingStatus) ? (bookingStatus as ExtractedBooking["booking_status"]) : "unknown",
    amount_cents: asAmountCents(value.amount_cents ?? value.amount),
    currency: asText(value.currency).toLowerCase() || "cad",
    start_date: asText(value.start_date),
    end_date: asText(value.end_date),
    start_time: asText(value.start_time),
    end_time: asText(value.end_time),
    address: asText(value.address),
    city: asText(value.city),
    region: asText(value.region),
    country: asText(value.country),
    latitude: asNullableNumber(value.latitude),
    longitude: asNullableNumber(value.longitude),
    raw_extracted_text: asText(value.raw_extracted_text),
    extraction_confidence: confidenceValues.has(confidence) ? (confidence as ExtractedBooking["extraction_confidence"]) : "medium",
    metadata: typeof value.metadata === "object" && value.metadata ? (value.metadata as Record<string, unknown>) : {}
  };
}

export async function extractBookingFromScreenshot(file: File): Promise<{ booking: ExtractedBooking; aiUsed: boolean }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type || "image/png"};base64,${buffer.toString("base64")}`;
  const client = getOpenAIClient();

  if (!client) {
    return {
      aiUsed: false,
      booking: normalizeExtractedBooking({
        title: file.name || "Uploaded booking screenshot",
        booking_type: "other",
        raw_extracted_text: "OpenAI vision is not configured. Confirm the booking manually.",
        extraction_confidence: "low",
        metadata: { fileName: file.name, mimeType: file.type }
      })
    };
  }

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract travel booking details from screenshots. Return strict JSON only. Never include card numbers, CVV, or payment credentials."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Extract a travel booking. Fields: booking_type, provider_name, title, confirmation_number, booking_status, amount_cents, currency, start_date, end_date, start_time, end_time, address, city, region, country, latitude, longitude, raw_extracted_text, extraction_confidence, metadata. If unsure, use empty string/null and low confidence."
          },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  return {
    aiUsed: true,
    booking: normalizeExtractedBooking({
      ...parseJsonObject(raw),
      metadata: { fileName: file.name, mimeType: file.type, aiModel: completion.model }
    })
  };
}

function combineBookingDateTime(
  dateValue: string | null | undefined,
  timeValue: string | null | undefined
) {
  if (!dateValue) return null;

  const time = timeValue?.trim() || "00:00:00";
  const normalizedTime =
    /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;

  const value = new Date(`${dateValue}T${normalizedTime}Z`);

  return Number.isNaN(value.getTime())
    ? null
    : value.toISOString();
}

export async function saveConfirmedBooking(
  supabase: SupabaseClient,
  params: {
    userId: string;
    tripId: string;
    booking: ExtractedBooking;
    sourceType?: "screenshot" | "email" | "gmail" | "outlook";
  }
) {
  const { booking } = params;

  const result = await createTripBooking({
    supabase,
    userId: params.userId,
    tripId: params.tripId,
    input: {
      bookingType: booking.booking_type,
      bookingStatus:
        booking.booking_status === "cancelled"
          ? "cancelled"
          : booking.booking_status === "unknown"
            ? "pending"
            : "confirmed",

      provider: booking.provider_name || null,
      confirmationCode:
        booking.confirmation_number || null,

      sourceType: params.sourceType || "screenshot",
      sourceReference:
        typeof booking.metadata?.messageId === "string"
          ? booking.metadata.messageId
          : typeof booking.metadata?.sourceReference === "string"
            ? booking.metadata.sourceReference
            : null,

      title: booking.title || "Imported booking",

      startTime: combineBookingDateTime(
        booking.start_date,
        booking.start_time
      ),
      endTime: combineBookingDateTime(
        booking.end_date,
        booking.end_time
      ),

      checkInTime:
        booking.booking_type === "hotel"
          ? combineBookingDateTime(
              booking.start_date,
              booking.start_time
            )
          : null,

      checkOutTime:
        booking.booking_type === "hotel"
          ? combineBookingDateTime(
              booking.end_date,
              booking.end_time
            )
          : null,

      address: booking.address || null,
      locationName:
        booking.city ||
        booking.address ||
        null,

      coordinates:
        typeof booking.latitude === "number" &&
        typeof booking.longitude === "number"
          ? {
              latitude: booking.latitude,
              longitude: booking.longitude
            }
          : null,

      totalPrice:
        typeof booking.amount_cents === "number"
          ? booking.amount_cents / 100
          : null,

      currency: booking.currency || "cad",
      travelerConfirmed: true,
      lastSyncedAt: new Date().toISOString()
    }
  });

  if (result.error || !result.booking) {
    return {
      booking: null,
      error: result.error || "Booking could not be saved."
    };
  }

  await recordTripEvent(supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventType: "booking_imported",
    eventTitle:
      booking.title || "Booking imported",
    eventBody:
      "The imported booking was processed through the Roamly Booking Wallet and Companion pipeline.",
    metadata: {
      bookingId: result.booking.id,
      sourceType: params.sourceType || "screenshot",
      meaningfulChange:
        result.meaningfulChange || null,
      companionTriggered:
        Boolean(result.companionWorkflow)
    }
  });

  return {
    booking: result.booking,
    meaningfulChange:
      result.meaningfulChange || null,
    companionWorkflow:
      result.companionWorkflow || null,
    created: result.created,
    error: null
  };
}

export async function getConfirmedBookingCostCents(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_bookings")
    .select("amount_cents")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .neq("booking_status", "cancelled");

  if (error) return { amountCents: 0, error: error.message };
  return {
    amountCents: (data || []).reduce((sum, row) => sum + (row.amount_cents || 0), 0),
    error: null
  };
}

export async function getConfirmedBookingsForItinerary(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data, error } = await supabase
    .from("roamly_bookings")
    .select("booking_type,title,provider_name,booking_status,amount_cents,currency,start_date,end_date,start_time,end_time,address,city,country")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .neq("booking_status", "cancelled")
    .order("start_date", { ascending: true, nullsFirst: false })
    .limit(20);

  if (error) return { bookings: [], error: error.message };
  return { bookings: data || [], error: null };
}
