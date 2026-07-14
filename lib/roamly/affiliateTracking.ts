import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { createTripBooking, type TripBookingInput, type TripBookingType } from "@/lib/roamly/bookingWallet";

export type AffiliatePartner = "travelpayouts" | "stay22" | "klook" | "amazon" | "airalo" | "other";

export type AffiliateClickInput = {
  userId: string;
  tripId: string;
  recommendationId?: string | null;
  provider?: string | null;
  affiliatePartner?: string | null;
  destinationUrl: string;
  affiliateUrl: string;
  deviceContext?: Record<string, unknown>;
};

export type AffiliateConversionInput = {
  subId?: string | null;
  affiliateClickId?: string | null;
  provider?: string | null;
  affiliatePartner?: string | null;
  externalOrderId?: string | null;
  bookingType?: string | null;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  commissionStatus?: string | null;
  bookedAt?: string | null;
  cancelledAt?: string | null;
  refundedAt?: string | null;
  rawEventReference?: string | null;
  reliable?: boolean;
  booking?: Partial<TripBookingInput> | null;
};

type AffiliateClickRecord = {
  id: string;
  user_id: string;
  trip_id: string;
  provider: string;
  affiliate_partner: AffiliatePartner;
  destination_url: string;
  affiliate_url: string;
  sub_id: string;
};

type AffiliateConversionRecord = {
  id: string;
  affiliate_click_id: string | null;
  trip_id: string;
  user_id: string;
  provider: string;
  affiliate_partner: AffiliatePartner;
  external_order_id: string | null;
  booking_type: TripBookingType;
  status: string;
  amount: number | null;
  currency: string | null;
};

const bookingTypes = new Set(["flight", "hotel", "train", "bus", "ferry", "rental_car", "transfer", "activity", "restaurant", "insurance", "other"]);
const statuses = new Set(["detected", "confirmed", "modified", "cancelled", "refunded", "completed", "needs_confirmation"]);

function clean(value?: string | null) {
  return (value || "").trim();
}

function money(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100) / 100;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed * 100) / 100;
  }
  return null;
}

function timestamp(value?: string | null) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function currency(value?: string | null) {
  const text = clean(value).toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

export function affiliatePartnerForProvider(provider?: string | null): AffiliatePartner {
  const text = clean(provider).toLowerCase();
  if (text.includes("travelpayouts") || text.includes("aviasales")) return "travelpayouts";
  if (text.includes("stay22")) return "stay22";
  if (text.includes("klook")) return "klook";
  if (text.includes("amazon")) return "amazon";
  if (text.includes("airalo") || text.includes("esim")) return "airalo";
  return "other";
}

export function createAffiliateSubId() {
  return `rc_${randomBytes(18).toString("base64url")}`;
}

export function appendAffiliateSubId(rawUrl: string, partner: AffiliatePartner, subId: string) {
  const safe = safeExternalUrl(rawUrl);
  if (!safe) return "";
  const url = new URL(safe);
  const param =
    partner === "stay22"
      ? "sid"
      : partner === "klook"
        ? "aff_sub"
      : partner === "amazon"
        ? "ascsubtag"
      : "sub_id";
  url.searchParams.set(param, subId);
  return url.toString();
}

async function assertTripOwnership(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data, error } = await supabase.from("roamly_trips").select("id").eq("id", tripId).eq("user_id", userId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "TRIP_NOT_FOUND" };
  return { ok: true as const };
}

export async function createAffiliateClick(params: {
  supabase: SupabaseClient;
  input: AffiliateClickInput;
}) {
  const ownership = await assertTripOwnership(params.supabase, params.input.userId, params.input.tripId);
  if (!ownership.ok) return { click: null, redirectUrl: safeExternalUrl(params.input.affiliateUrl), error: ownership.error };

  const affiliateUrl = safeExternalUrl(params.input.affiliateUrl);
  const destinationUrl = safeExternalUrl(params.input.destinationUrl) || affiliateUrl;
  if (!affiliateUrl || !destinationUrl) return { click: null, redirectUrl: "", error: "INVALID_AFFILIATE_URL" };

  const partner = affiliatePartnerForProvider(params.input.affiliatePartner || params.input.provider);
  const subId = createAffiliateSubId();
  const redirectUrl = appendAffiliateSubId(affiliateUrl, partner, subId);
  const { data, error } = await params.supabase
    .from("affiliate_clicks")
    .insert({
      user_id: params.input.userId,
      trip_id: params.input.tripId,
      recommendation_id: clean(params.input.recommendationId) || null,
      provider: clean(params.input.provider) || partner,
      affiliate_partner: partner,
      destination_url: destinationUrl,
      affiliate_url: affiliateUrl,
      sub_id: subId,
      device_context: params.input.deviceContext || {}
    })
    .select("*")
    .single();

  if (error) return { click: null, redirectUrl: affiliateUrl, error: error.message };
  return { click: data as AffiliateClickRecord, redirectUrl: redirectUrl || affiliateUrl, error: null };
}

function normalizedBookingType(value?: string | null): TripBookingType {
  const text = clean(value);
  return (bookingTypes.has(text) ? text : "other") as TripBookingType;
}

function normalizedConversionStatus(value?: string | null, reliable?: boolean) {
  const text = clean(value);
  if (statuses.has(text)) return text;
  return reliable ? "confirmed" : "detected";
}

async function findAffiliateClick(supabase: SupabaseClient, input: AffiliateConversionInput) {
  if (input.affiliateClickId) {
    const { data } = await supabase.from("affiliate_clicks").select("*").eq("id", input.affiliateClickId).maybeSingle();
    if (data) return data as AffiliateClickRecord;
  }
  if (input.subId) {
    const { data } = await supabase.from("affiliate_clicks").select("*").eq("sub_id", input.subId).maybeSingle();
    if (data) return data as AffiliateClickRecord;
  }
  return null;
}

function conversionBookingInput(params: {
  input: AffiliateConversionInput;
  click: AffiliateClickRecord;
  conversionId: string;
  status: string;
}): TripBookingInput {
  const booking = params.input.booking || {};
  const bookingStatus = params.status === "confirmed" || params.input.reliable ? "confirmed" : "detected";
  const title = booking.title || `${params.click.provider || params.input.provider || "Travel"} booking`;
  return {
    ...booking,
    bookingType: params.input.bookingType || booking.bookingType,
    bookingStatus,
    provider: params.input.provider || booking.provider || params.click.provider,
    affiliateClickId: params.click.id,
    affiliateConversionId: params.conversionId,
    sourceType: "affiliate_conversion",
    sourceReference: params.input.externalOrderId || params.input.rawEventReference || params.input.subId || params.click.sub_id,
    title,
    totalPrice: params.input.amount ?? booking.totalPrice ?? null,
    currency: params.input.currency || booking.currency || null,
    travelerConfirmed: bookingStatus === "confirmed",
    lastSyncedAt: new Date().toISOString()
  };
}

export async function recordAffiliateConversion(params: {
  supabase: SupabaseClient;
  input: AffiliateConversionInput;
}) {
  const click = await findAffiliateClick(params.supabase, params.input);
  if (!click) return { conversion: null, booking: null, error: "AFFILIATE_CLICK_NOT_FOUND", needsConfirmation: true };

  const partner = affiliatePartnerForProvider(params.input.affiliatePartner || params.input.provider || click.affiliate_partner);
  const status = normalizedConversionStatus(params.input.status, params.input.reliable);
  const bookingType = normalizedBookingType(params.input.bookingType);
  const row = {
    affiliate_click_id: click.id,
    trip_id: click.trip_id,
    user_id: click.user_id,
    provider: clean(params.input.provider) || click.provider,
    affiliate_partner: partner,
    external_order_id: clean(params.input.externalOrderId) || null,
    booking_type: bookingType,
    status,
    amount: money(params.input.amount),
    currency: currency(params.input.currency),
    commission_status: clean(params.input.commissionStatus) || null,
    booked_at: timestamp(params.input.bookedAt),
    cancelled_at: timestamp(params.input.cancelledAt),
    refunded_at: timestamp(params.input.refundedAt),
    raw_event_reference: clean(params.input.rawEventReference) || null
  };

  let existingConversion: { id: string } | null = null;
  if (row.external_order_id) {
    const { data } = await params.supabase
      .from("affiliate_conversions")
      .select("id")
      .eq("affiliate_partner", row.affiliate_partner)
      .eq("external_order_id", row.external_order_id)
      .maybeSingle();
    existingConversion = data as { id: string } | null;
  } else if (row.raw_event_reference) {
    const { data } = await params.supabase
      .from("affiliate_conversions")
      .select("id")
      .eq("affiliate_partner", row.affiliate_partner)
      .eq("raw_event_reference", row.raw_event_reference)
      .maybeSingle();
    existingConversion = data as { id: string } | null;
  }

  const saved = existingConversion
    ? await params.supabase.from("affiliate_conversions").update(row).eq("id", existingConversion.id).select("*").single()
    : await params.supabase.from("affiliate_conversions").insert(row).select("*").single();

  if (saved.error) return { conversion: null, booking: null, error: saved.error.message, needsConfirmation: true };

  const conversion = saved.data as AffiliateConversionRecord;
  const hasTravelDetails = Boolean(params.input.booking?.title || params.input.booking?.startTime || params.input.booking?.checkInTime);
  const existingBooking = await params.supabase
    .from("trip_bookings")
    .select("*")
    .eq("affiliate_conversion_id", conversion.id)
    .eq("user_id", click.user_id)
    .maybeSingle();
  if (existingBooking.data) {
    return {
      conversion,
      booking: existingBooking.data,
      error: null,
      needsConfirmation: !params.input.reliable || !hasTravelDetails,
      message: hasTravelDetails
        ? null
        : "We found your booking. Add the confirmation details to activate live tracking."
    };
  }

  const savedBooking = await createTripBooking({
    supabase: params.supabase,
    userId: click.user_id,
    tripId: click.trip_id,
    input: conversionBookingInput({
      input: params.input,
      click,
      conversionId: conversion.id,
      status
    })
  });

  return {
    conversion,
    booking: savedBooking.booking,
    error: savedBooking.error,
    needsConfirmation: !params.input.reliable || !hasTravelDetails,
    message: hasTravelDetails
      ? null
      : "We found your booking. Add the confirmation details to activate live tracking."
  };
}

export function verifyAffiliateWebhookSignature(params: {
  rawBody: string;
  signature: string | null;
  secret?: string | null;
}) {
  const secret = clean(params.secret);
  const signature = clean(params.signature);
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(params.rawBody).digest("hex");
  const normalized = signature.replace(/^sha256=/i, "");
  const left = Buffer.from(normalized, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeAffiliateConversionEvent(body: Record<string, unknown>): AffiliateConversionInput {
  const partner = clean(body.affiliate_partner as string) || clean(body.partner as string) || clean(body.network as string);
  return {
    subId: clean(body.sub_id as string) || clean(body.subId as string) || clean(body.click_id as string) || null,
    affiliateClickId: clean(body.affiliate_click_id as string) || null,
    provider: clean(body.provider as string) || partner || null,
    affiliatePartner: partner || null,
    externalOrderId: clean(body.external_order_id as string) || clean(body.order_id as string) || clean(body.booking_id as string) || null,
    bookingType: clean(body.booking_type as string) || clean(body.category as string) || null,
    status: clean(body.status as string) || null,
    amount: money(body.amount ?? body.total ?? body.price),
    currency: clean(body.currency as string) || null,
    commissionStatus: clean(body.commission_status as string) || clean(body.commissionStatus as string) || null,
    bookedAt: clean(body.booked_at as string) || clean(body.created_at as string) || null,
    cancelledAt: clean(body.cancelled_at as string) || null,
    refundedAt: clean(body.refunded_at as string) || null,
    rawEventReference: clean(body.event_id as string) || clean(body.id as string) || clean(body.raw_event_reference as string) || null,
    reliable: body.reliable === true || body.verified === true,
    booking:
      body.booking && typeof body.booking === "object" && !Array.isArray(body.booking)
        ? (body.booking as Partial<TripBookingInput>)
        : null
  };
}
