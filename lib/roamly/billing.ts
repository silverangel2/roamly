import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { roamlyConfig } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { unlockLiveCompanion } from "@/lib/roamly/tripCompanion";
import { recordAppEvent, recordTripEvent } from "@/lib/roamly/events";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";

export type RoamlyPurchaseType = "itinerary_unlock" | "tracking_addon" | "bundle";
export type RoamlyItineraryUnlockSource = "free" | "paid" | "bundle" | "admin";

export type RoamlyBillingTrip = {
  id: string;
  user_id: string;
  itinerary_status?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_generated_at?: string | null;
  itinerary_payment_status?: string | null;
  itinerary_unlock_source?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

type RoamlyQaTrip = Pick<RoamlyBillingTrip, "id" | "user_id" | "metadata">;

const purchaseOptions: Record<
  RoamlyPurchaseType,
  { priceId: string; amount: number; name: string; description: string }
> = {
  itinerary_unlock: {
    priceId: roamlyConfig.itineraryUnlockPriceId,
    amount: roamlyConfig.itineraryUnlockPriceCents,
    name: "Roamly Full Itinerary Unlock",
    description: "One custom full itinerary for one trip. No subscription."
  },
  tracking_addon: {
    priceId: roamlyConfig.trackingAddonPriceId,
    amount: roamlyConfig.trackingAddonPriceCents,
    name: "Roamly Live Trip Companion",
    description: "Pre-trip reminders, booking timeline, nearby activities, and up-next help for one locked itinerary."
  },
  bundle: {
    priceId: roamlyConfig.tripBundlePriceId,
    amount: roamlyConfig.tripBundlePriceCents,
    name: "Roamly Complete Trip Pack",
    description: "Full itinerary plus Live Trip Companion for one trip."
  }
};

export function normalizePurchaseType(value: unknown): RoamlyPurchaseType {
  if (value === "itinerary_unlock" || value === "tracking_addon" || value === "bundle") return value;
  if (value === "itinerary") return "itinerary_unlock";
  if (value === "features" || value === "tracking") return "tracking_addon";
  return "bundle";
}

export function getPurchaseOption(type: RoamlyPurchaseType) {
  return purchaseOptions[type];
}

export function getCheckoutSuccessUrl(tripId: string) {
  return `${roamlyConfig.appUrl}/trip/${tripId}?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
}

function paymentIntentId(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
}

export function isTripLocked(trip: Pick<RoamlyBillingTrip, "itinerary_locked" | "itinerary_status" | "itinerary_generated_at">) {
  return Boolean(trip.itinerary_locked || trip.itinerary_status === "locked" || trip.itinerary_generated_at);
}

export function tripHasTrackingUnlock(trip: Pick<RoamlyBillingTrip, "tracking_unlocked">) {
  return Boolean(trip.tracking_unlocked || (trip as { live_companion_unlocked?: boolean | null }).live_companion_unlocked);
}

export function tripIsQaTester(trip: Pick<RoamlyBillingTrip, "metadata">) {
  return Boolean(trip.metadata?.qa_tester);
}

export async function markTripAsQaTester(
  supabase: SupabaseClient,
  userId: string,
  tripId: string,
  extraMetadata: Record<string, unknown> = {}
) {
  const writer = createSupabaseAdminClient() || supabase;
  const { data: trip, error } = await writer
    .from("roamly_trips")
    .select("id,user_id,metadata")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!trip) return { ok: false as const, error: "Trip not found." };

  const typed = trip as RoamlyQaTrip;
  const { error: updateError } = await writer
    .from("roamly_trips")
    .update({
      metadata: {
        ...(typed.metadata || {}),
        ...extraMetadata,
        qa_tester: true
      }
    })
    .eq("id", tripId)
    .eq("user_id", userId);

  if (updateError) return { ok: false as const, error: updateError.message };
  return { ok: true as const };
}

export async function getUserItineraryEntitlement(supabase: SupabaseClient, userId: string) {
  const writer = createSupabaseAdminClient() || supabase;
  const { data, error } = await writer
    .from("roamly_user_entitlements")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { entitlement: null, error: error.message };
  if (data) return { entitlement: data as { free_itinerary_used_at: string | null; free_itinerary_trip_id: string | null }, error: null };

  const inserted = await writer
    .from("roamly_user_entitlements")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (inserted.error) return { entitlement: null, error: inserted.error.message };
  return { entitlement: inserted.data as { free_itinerary_used_at: string | null; free_itinerary_trip_id: string | null }, error: null };
}

export async function hasUsedFreeItinerary(supabase: SupabaseClient, userId: string) {
  const result = await getUserItineraryEntitlement(supabase, userId);
  return {
    used: Boolean(result.entitlement?.free_itinerary_used_at),
    entitlement: result.entitlement,
    error: result.error
  };
}

export async function markFreeItineraryUsed(supabase: SupabaseClient, userId: string, tripId: string) {
  const entitlement = await getUserItineraryEntitlement(supabase, userId);
  if (entitlement.error) return { ok: false, error: entitlement.error };

  const now = new Date().toISOString();
  const writer = createSupabaseAdminClient() || supabase;
  const { data, error } = await writer
    .from("roamly_user_entitlements")
    .update({
      free_itinerary_used_at: now,
      free_itinerary_trip_id: tripId
    })
    .eq("user_id", userId)
    .is("free_itinerary_used_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "FREE_ITINERARY_ALREADY_USED" };
  await recordAppEvent(writer, {
    userId,
    eventType: "free_itinerary_used",
    metadata: { tripId }
  });
  return { ok: true };
}

export async function canGenerateFinalItinerary(
  supabase: SupabaseClient,
  userId: string,
  tripId: string,
  userEmail?: string | null
) {
  const { data: trip, error } = await supabase
    .from("roamly_trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!trip) return { ok: false as const, status: 404, error: "Trip not found." };
  if (isTripLocked(trip)) {
    return {
      ok: false as const,
      status: 409,
      error: "ITINERARY_LOCKED",
      message: "This itinerary is already generated and cannot be edited.",
      trip
    };
  }
  if (trip.itinerary_status === "generating" || trip.status === "generating") {
    return {
      ok: false as const,
      status: 409,
      error: "ITINERARY_GENERATING",
      message: "This itinerary is already being generated.",
      trip
    };
  }

  if (trip.itinerary_payment_status === "paid" || trip.itinerary_unlock_source === "paid") {
    return { ok: true as const, source: "paid" as const, trip };
  }

  if (trip.itinerary_payment_status === "bundled" || trip.itinerary_unlock_source === "bundle") {
    return { ok: true as const, source: "bundle" as const, trip };
  }

  if (trip.itinerary_unlock_source === "admin") {
    return { ok: true as const, source: "admin" as const, trip };
  }

  const access = getRoamlyAccessForUser(userEmail);
  if (access.hasQaAccess) {
    return { ok: true as const, source: "admin" as const, trip, qaTester: true as const };
  }

  const free = await hasUsedFreeItinerary(supabase, userId);
  if (free.error) return { ok: false as const, status: 500, error: free.error };
  if (!free.used) return { ok: true as const, source: "free" as const, trip };

  return {
    ok: false as const,
    status: 402,
    error: "PAYMENT_REQUIRED",
    message: "You’ve used your free itinerary. Unlock this trip to generate a new full itinerary.",
    trip
  };
}

export async function lockGeneratedItinerary(
  supabase: SupabaseClient,
  userId: string,
  tripId: string,
  source: RoamlyItineraryUnlockSource
) {
  const now = new Date().toISOString();
  const paymentStatus = source === "free" ? "free" : source === "bundle" ? "bundled" : "paid";
  return supabase
    .from("roamly_trips")
    .update({
      status: "locked",
      is_activated: true,
      activated_at: now,
      itinerary_status: "locked",
      itinerary_locked: true,
      itinerary_locked_at: now,
      itinerary_generated_at: now,
      itinerary_unlock_source: source,
      itinerary_payment_status: paymentStatus
    })
    .eq("id", tripId)
    .eq("user_id", userId);
}

export async function requireTripEditable(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data: trip, error } = await supabase
    .from("roamly_trips")
    .select("id,user_id,itinerary_locked,itinerary_status,itinerary_generated_at")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!trip) return { ok: false as const, status: 404, error: "Trip not found." };
  if (isTripLocked(trip)) {
    return {
      ok: false as const,
      status: 409,
      error: "ITINERARY_LOCKED",
      message: "This itinerary is already generated and cannot be edited."
    };
  }
  return { ok: true as const, trip };
}

export async function requireTripLockedForTracking(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data: trip, error } = await supabase
    .from("roamly_trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!trip) return { ok: false as const, status: 404, error: "Trip not found." };
  if (!isTripLocked(trip)) {
    return {
      ok: false as const,
      status: 409,
      error: "ITINERARY_NOT_LOCKED",
      message: "Generate and lock this itinerary before adding Live Trip Companion."
    };
  }
  return { ok: true as const, trip };
}

async function createCheckoutSession(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  tripId: string,
  purchaseType: RoamlyPurchaseType
) {
  const stripe = createStripeClient();
  if (!stripe) return { ok: false as const, status: 503, error: "Stripe checkout needs STRIPE_SECRET_KEY." };

  const option = getPurchaseOption(purchaseType);
  const lineItem = option.priceId
    ? { price: option.priceId, quantity: 1 }
    : {
        price_data: {
          currency: roamlyConfig.currency,
          unit_amount: option.amount,
          product_data: {
            name: option.name,
            description: option.description
          }
        },
        quantity: 1
      };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email || undefined,
    line_items: [lineItem],
    success_url: getCheckoutSuccessUrl(tripId),
    cancel_url: `${roamlyConfig.appUrl}/trip/${tripId}?checkout=cancelled`,
    metadata: {
      app: "roamly",
      user_id: user.id,
      userId: user.id,
      trip_id: tripId,
      tripId,
      purchase_type:
        purchaseType === "itinerary_unlock"
          ? "itinerary"
          : purchaseType === "tracking_addon"
            ? "features"
            : "complete_trip",
      checkoutKind: purchaseType
    }
  });

  const writer = createSupabaseAdminClient() || supabase;

  await writer.from("roamly_itinerary_purchases").insert({
    user_id: user.id,
    trip_id: tripId,
    purchase_type: purchaseType,
    amount_cents: session.amount_total || option.amount,
    currency: session.currency || roamlyConfig.currency,
    stripe_checkout_session_id: session.id,
    status: "pending"
  });

  await writer.from("roamly_trip_payments").insert({
    user_id: user.id,
    trip_id: tripId,
    stripe_session_id: session.id,
    amount: session.amount_total || option.amount,
    currency: session.currency || roamlyConfig.currency,
    status: "pending"
  });

  return { ok: true as const, url: session.url, sessionId: session.id };
}

export async function createItineraryCheckoutSession(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  tripId: string
) {
  const editable = await requireTripEditable(supabase, user.id, tripId);
  if (!editable.ok) return editable;
  const access = getRoamlyAccessForUser(user.email);
  if (access.hasQaAccess) {
    await markTripAsQaTester(supabase, user.id, tripId, { qa_checkout_kind: "itinerary" });
    return { ok: true as const, alreadyUnlocked: true, tester: true as const, url: `/trip/${tripId}` };
  }
  return createCheckoutSession(supabase, user, tripId, "itinerary_unlock");
}

export async function createTrackingCheckoutSession(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  tripId: string
) {
  const locked = await requireTripLockedForTracking(supabase, user.id, tripId);
  if (!locked.ok) return locked;
  const access = getRoamlyAccessForUser(user.email);
  if (access.hasQaAccess) {
    await markTripAsQaTester(supabase, user.id, tripId, { qa_checkout_kind: "tracking" });
    await unlockLiveCompanion(supabase, tripId, "admin");
    return { ok: true as const, alreadyUnlocked: true, tester: true as const, url: `/trip/${tripId}/live` };
  }
  if (tripHasTrackingUnlock(locked.trip)) {
    return { ok: true as const, alreadyUnlocked: true, url: `/trip/${tripId}/live` };
  }
  return createCheckoutSession(supabase, user, tripId, "tracking_addon");
}

export const createFeaturesCheckoutSession = createTrackingCheckoutSession;

export async function createBundleCheckoutSession(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  tripId: string
) {
  const editable = await requireTripEditable(supabase, user.id, tripId);
  if (!editable.ok) return editable;
  const access = getRoamlyAccessForUser(user.email);
  if (access.hasQaAccess) {
    await markTripAsQaTester(supabase, user.id, tripId, { qa_checkout_kind: "complete" });
    const writer = createSupabaseAdminClient() || supabase;
    await writer
      .from("roamly_trips")
      .update({
        itinerary_unlock_source: "admin",
        tracking_unlocked: true,
        tracking_unlock_source: "admin",
        live_companion_unlocked: true,
        live_companion_unlocked_at: new Date().toISOString(),
        live_companion_source: "admin"
      })
      .eq("id", tripId)
      .eq("user_id", user.id);
    await unlockLiveCompanion(writer, tripId, "admin");
    return { ok: true as const, alreadyUnlocked: true, tester: true as const, url: `/trip/${tripId}` };
  }
  return createCheckoutSession(supabase, user, tripId, "bundle");
}

export const createCompleteTripCheckoutSession = createBundleCheckoutSession;

export async function applyPaidItineraryPurchase(supabase: SupabaseClient, session: Stripe.Checkout.Session) {
  const tripId = session.metadata?.trip_id || session.metadata?.tripId;
  const userId = session.metadata?.user_id || session.metadata?.userId;
  const purchaseType = normalizePurchaseType(session.metadata?.purchase_type || session.metadata?.checkoutKind);
  const now = new Date().toISOString();

  if (!tripId || !userId) return { ok: false, error: "Checkout session is missing trip metadata." };
  if (session.payment_status !== "paid") return { ok: false, error: "Checkout session is not paid yet." };

  const tripResult = await supabase
    .from("roamly_trips")
    .select("id,user_id,itinerary_locked,itinerary_status,itinerary_generated_at,tracking_unlocked,live_companion_unlocked")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (tripResult.error) return { ok: false, error: tripResult.error.message };
  if (!tripResult.data) return { ok: false, error: "Trip not found for checkout session." };

  const tripAlreadyLocked = isTripLocked(tripResult.data);
  const update: Record<string, unknown> = {};
  if (purchaseType === "itinerary_unlock" && !tripAlreadyLocked) {
    update.itinerary_payment_status = "paid";
    update.itinerary_unlock_source = "paid";
    update.stripe_checkout_session_id = session.id;
    update.stripe_payment_intent_id = paymentIntentId(session);
    update.itinerary_status = "draft";
  }

  if (purchaseType === "tracking_addon") {
    update.tracking_unlocked = true;
    update.tracking_unlock_source = "paid";
    update.tracking_paid_at = now;
    update.tracking_stripe_checkout_session_id = session.id;
    update.tracking_stripe_payment_intent_id = paymentIntentId(session);
    update.live_companion_unlocked = true;
    update.live_companion_unlocked_at = now;
    update.live_companion_source = "paid";
  }

  if (purchaseType === "bundle" && !tripAlreadyLocked) {
    update.itinerary_payment_status = "bundled";
    update.itinerary_unlock_source = "bundle";
    update.stripe_checkout_session_id = session.id;
    update.stripe_payment_intent_id = paymentIntentId(session);
    update.itinerary_status = "draft";
  }

  if (purchaseType === "bundle") {
    update.tracking_unlocked = true;
    update.tracking_unlock_source = "bundle";
    update.tracking_paid_at = now;
    update.tracking_stripe_checkout_session_id = session.id;
    update.tracking_stripe_payment_intent_id = paymentIntentId(session);
    update.live_companion_unlocked = true;
    update.live_companion_unlocked_at = now;
    update.live_companion_source = "bundle";
  }

  if (Object.keys(update).length) {
    const tripUpdate = await supabase
      .from("roamly_trips")
      .update(update)
      .eq("id", tripId)
      .eq("user_id", userId);

    if (tripUpdate.error) return { ok: false, error: tripUpdate.error.message };
  }

  await supabase.from("roamly_itinerary_purchases").upsert(
    {
      user_id: userId,
      trip_id: tripId,
      purchase_type: purchaseType,
      amount_cents: session.amount_total || getPurchaseOption(purchaseType).amount,
      currency: session.currency || roamlyConfig.currency,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId(session),
      status: "paid",
      paid_at: now,
      metadata: { stripe_status: session.status }
    },
    { onConflict: "stripe_checkout_session_id" }
  );

  await supabase.from("roamly_trip_payments").upsert(
    {
      user_id: userId,
      trip_id: tripId,
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntentId(session),
      amount: session.amount_total || getPurchaseOption(purchaseType).amount,
      currency: session.currency || roamlyConfig.currency,
      status: session.payment_status
    },
    { onConflict: "stripe_session_id" }
  );

  if (purchaseType === "tracking_addon") {
    await unlockLiveCompanion(supabase, tripId, "paid");
  } else if (purchaseType === "bundle") {
    await unlockLiveCompanion(supabase, tripId, "bundle");
  }

  await recordAppEvent(supabase, {
    userId,
    eventType: "checkout_completed",
    metadata: {
      tripId,
      purchaseType,
      amountCents: session.amount_total || getPurchaseOption(purchaseType).amount,
      currency: session.currency || roamlyConfig.currency,
      checkoutSessionId: session.id
    }
  });
  await recordTripEvent(supabase, {
    userId,
    tripId,
    eventType:
      purchaseType === "itinerary_unlock"
        ? "paid_itinerary_unlocked"
        : purchaseType === "tracking_addon"
          ? "companion_unlocked"
          : "complete_pack_unlocked",
    eventTitle:
      purchaseType === "itinerary_unlock"
        ? "Paid itinerary unlocked"
        : purchaseType === "tracking_addon"
          ? "Live Companion unlocked"
          : "Complete Trip Pack unlocked",
    metadata: {
      purchaseType,
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntentId(session)
    }
  });

  return { ok: true, purchaseType };
}
