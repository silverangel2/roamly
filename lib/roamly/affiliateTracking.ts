import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { createTripBooking, type TripBookingInput, type TripBookingType } from "@/lib/roamly/bookingWallet";
import { reconcileTripBookings } from "@/lib/roamly/brain/bookingReconciliation";

export type AffiliatePartner = "travelpayouts" | "stay22" | "klook" | "amazon" | "airalo" | "other";

export type AffiliateClickInput = {
  userId: string;
  tripId: string;
  recommendationId?: string | null;
  bookingType?: string | null;
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
  recommendation_id: string | null;
  booking_type: TripBookingType;
  provider: string;
  affiliate_partner: AffiliatePartner;
  destination_url: string;
  affiliate_url: string;
  sub_id: string;
};

function referralRowToClick(row: Record<string, unknown>): AffiliateClickRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    trip_id: String(row.trip_id),
    recommendation_id: typeof row.recommendation_id === "string" ? row.recommendation_id : null,
    booking_type: normalizedBookingType(typeof row.booking_type === "string" ? row.booking_type : null),
    provider: typeof row.provider === "string" ? row.provider : "other",
    affiliate_partner: (typeof row.commercial_partner === "string" ? row.commercial_partner : "other") as AffiliatePartner,
    destination_url: String(row.destination_url || ""),
    affiliate_url: String(row.affiliate_url || ""),
    sub_id: typeof row.provider_tracking_reference === "string" ? row.provider_tracking_reference : ""
  };
}

export type ResolvedAffiliateReferral = AffiliateClickRecord & {
  recommendationTitle: string | null;
  category: string | null;
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

async function recommendationBelongsToTrip(supabase: SupabaseClient, userId: string, tripId: string, recommendationId: string) {
  const { data, error } = await supabase
    .from("roamly_itineraries")
    .select("full_json")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  const full = data?.full_json && typeof data.full_json === "object" && !Array.isArray(data.full_json)
    ? data.full_json as Record<string, unknown>
    : null;
  const suggestions = Array.isArray(full?.booking_suggestions) ? full.booking_suggestions : [];
  const found = suggestions.some((suggestion) => {
    if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) return false;
    return (suggestion as Record<string, unknown>).candidateId === recommendationId;
  });
  return found ? { ok: true as const } : { ok: false as const, error: "RECOMMENDATION_NOT_FOUND" };
}

export async function resolveAffiliateReferral(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  affiliateClickId: string;
  recommendationId?: string | null;
}) {
  const ownership = await assertTripOwnership(params.supabase, params.userId, params.tripId);
  if (!ownership.ok) return { referral: null, error: ownership.error };

  const { data, error } = await params.supabase
    .from("roamly_booking_referrals")
    .select("*")
    .eq("id", params.affiliateClickId)
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .maybeSingle();
  if (error) return { referral: null, error: error.message };
  if (!data) return { referral: null, error: "AFFILIATE_REFERRAL_NOT_FOUND" };
  const click = referralRowToClick(data as Record<string, unknown>);
  if (!click.recommendation_id) return { referral: null, error: "AFFILIATE_REFERRAL_IDENTITY_INCOMPLETE" };
  if (params.recommendationId && click.recommendation_id !== params.recommendationId) {
    return { referral: null, error: "AFFILIATE_REFERRAL_MISMATCH" };
  }
  const recommendation = await recommendationBelongsToTrip(params.supabase, params.userId, params.tripId, click.recommendation_id);
  if (!recommendation.ok) return { referral: null, error: recommendation.error };

  const context = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : {};
  return {
    referral: {
      ...click,
      recommendationTitle: typeof context.recommendation_title === "string" ? context.recommendation_title : null,
      category: click.booking_type !== "other" ? click.booking_type : typeof context.category === "string" ? context.category : null
    } satisfies ResolvedAffiliateReferral,
    error: null
  };
}

export async function createAffiliateClick(params: {
  supabase: SupabaseClient;
  writer: SupabaseClient;
  input: AffiliateClickInput;
}) {
  const ownership = await assertTripOwnership(params.supabase, params.input.userId, params.input.tripId);
  if (!ownership.ok) return { click: null, redirectUrl: safeExternalUrl(params.input.affiliateUrl), error: ownership.error };

  const affiliateUrl = safeExternalUrl(params.input.affiliateUrl);
  const destinationUrl = safeExternalUrl(params.input.destinationUrl) || affiliateUrl;
  if (!affiliateUrl || !destinationUrl) return { click: null, redirectUrl: "", error: "INVALID_AFFILIATE_URL" };

  const recommendationId = clean(params.input.recommendationId);
  if (recommendationId) {
    const recommendation = await recommendationBelongsToTrip(params.supabase, params.input.userId, params.input.tripId, recommendationId);
    if (!recommendation.ok) return { click: null, redirectUrl: affiliateUrl, error: recommendation.error };
  }

  const partner = affiliatePartnerForProvider(params.input.affiliatePartner || params.input.provider);
  const subId = createAffiliateSubId();
  const redirectUrl = appendAffiliateSubId(affiliateUrl, partner, subId);
  const { data, error } = await params.writer
    .from("roamly_booking_referrals")
    .insert({
      user_id: params.input.userId,
      trip_id: params.input.tripId,
      provider: clean(params.input.provider) || partner,
      commercial_partner: partner,
      recommendation_id: recommendationId || null,
      booking_type: normalizedBookingType(params.input.bookingType),
      destination_url: destinationUrl,
      affiliate_url: affiliateUrl,
      provider_tracking_reference: subId,
      metadata: params.input.deviceContext || {}
    })
    .select("*")
    .single();

  if (error) return { click: null, redirectUrl: affiliateUrl, error: error.message };
  return { click: referralRowToClick(data as Record<string, unknown>), redirectUrl: redirectUrl || affiliateUrl, error: null };
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
    const { data } = await supabase.from("roamly_booking_referrals").select("*").eq("id", input.affiliateClickId).maybeSingle();
    if (data) return referralRowToClick(data as Record<string, unknown>);
  }
  if (input.subId) {
    const { data } = await supabase.from("roamly_booking_referrals").select("*").eq("provider_tracking_reference", input.subId).maybeSingle();
    if (data) return referralRowToClick(data as Record<string, unknown>);
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
    recommendationId: params.click.recommendation_id || booking.recommendationId || null,
    referralId: params.click.id,
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
  const conversionId = clean(params.input.externalOrderId) || clean(params.input.rawEventReference) || click.sub_id;
  const conversion: AffiliateConversionRecord = {
    id: conversionId,
    affiliate_click_id: click.id,
    trip_id: click.trip_id,
    user_id: click.user_id,
    provider: clean(params.input.provider) || click.provider,
    affiliate_partner: partner,
    external_order_id: clean(params.input.externalOrderId) || null,
    booking_type: bookingType,
    status,
    amount: money(params.input.amount),
    currency: currency(params.input.currency)
  };
  const hasTravelDetails = Boolean(params.input.booking?.title || params.input.booking?.startTime || params.input.booking?.checkInTime);
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
  if (savedBooking.booking?.id) {
    await reconcileTripBookings({
      supabase: params.supabase,
      userId: click.user_id,
      tripId: click.trip_id,
      sourceBookingId: savedBooking.booking.id
    }).catch(() => null);
  }

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
