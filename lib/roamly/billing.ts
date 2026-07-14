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
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

type RoamlyQaTrip = Pick<RoamlyBillingTrip, "id" | "user_id" | "metadata">;

const purchaseOptions: Record<
  RoamlyPurchaseType,
  { priceId: string; envName: string; amount: number; name: string; description: string }
> = {
  itinerary_unlock: {
    priceId: roamlyConfig.itineraryUnlockPriceId,
    envName: "ROAMLY_STRIPE_ITINERARY_PRICE_ID",
    amount: roamlyConfig.itineraryUnlockPriceCents,
    name: "Roamly Full Itinerary Unlock",
    description: "One custom full itinerary for one trip. No subscription."
  },
  tracking_addon: {
    priceId: roamlyConfig.trackingAddonPriceId,
    envName: "ROAMLY_STRIPE_FEATURES_PRICE_ID",
    amount: roamlyConfig.trackingAddonPriceCents,
    name: "Roamly Live Trip Companion",
    description: "Pre-trip reminders, booking timeline, nearby activities, and up-next help for one locked itinerary."
  },
  bundle: {
    priceId: roamlyConfig.tripBundlePriceId,
    envName: "ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID",
    amount: roamlyConfig.tripBundlePriceCents,
    name: "Roamly Complete Trip Pack",
    description: "Full itinerary plus Live Trip Companion for one trip."
  }
};

const GENERATING_STALE_AFTER_MS = 3 * 60 * 1000;

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

export function getStripeSecretMode() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return key ? "unknown" : "missing";
}

type CheckoutMode = "payment" | "subscription";

type ValidatedStripePrice = {
  ok: true;
  price: Stripe.Price;
  productId: string;
  productName: string;
  mode: CheckoutMode;
  interval: Stripe.Price.Recurring.Interval | null;
};

type StripePriceValidationError = {
  ok: false;
  status: number;
  error: string;
  message: string;
  envName: string;
};

function checkoutModeForPrice(price: Stripe.Price): CheckoutMode {
  return price.type === "recurring" ? "subscription" : "payment";
}

function getStripeProduct(price: Stripe.Price) {
  const product = price.product;
  if (!product || typeof product === "string" || "deleted" in product) return null;
  return product as Stripe.Product;
}

function safeStripeErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "type" in error && typeof (error as { type?: unknown }).type === "string") {
    return "Stripe rejected the configured Price. Check the production Price ID, key mode, and product state.";
  }
  return error instanceof Error ? error.message : "Stripe Price validation failed.";
}

export async function validateStripePriceForPurchase(
  stripe: Stripe,
  purchaseType: RoamlyPurchaseType
): Promise<ValidatedStripePrice | StripePriceValidationError> {
  const option = getPurchaseOption(purchaseType);
  if (!option.priceId) {
    return {
      ok: false,
      status: 503,
      error: "STRIPE_PRICE_MISSING",
      message: `${option.envName} is not configured in the production environment.`,
      envName: option.envName
    };
  }

  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(option.priceId, { expand: ["product"] });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: "STRIPE_PRICE_LOOKUP_FAILED",
      message: safeStripeErrorMessage(error),
      envName: option.envName
    };
  }

  const product = getStripeProduct(price);
  if (!price.active) {
    return {
      ok: false,
      status: 503,
      error: "STRIPE_PRICE_INACTIVE",
      message: `${option.envName} points to an inactive Stripe Price.`,
      envName: option.envName
    };
  }
  if (!product || !product.active) {
    return {
      ok: false,
      status: 503,
      error: "STRIPE_PRODUCT_INACTIVE",
      message: `${option.envName} belongs to an inactive or unavailable Stripe Product.`,
      envName: option.envName
    };
  }
  if (price.unit_amount !== option.amount) {
    return {
      ok: false,
      status: 503,
      error: "STRIPE_PRICE_AMOUNT_MISMATCH",
      message: `${option.envName} does not match Roamly's displayed amount.`,
      envName: option.envName
    };
  }
  if ((price.currency || "").toLowerCase() !== roamlyConfig.currency.toLowerCase()) {
    return {
      ok: false,
      status: 503,
      error: "STRIPE_PRICE_CURRENCY_MISMATCH",
      message: `${option.envName} does not match Roamly's checkout currency.`,
      envName: option.envName
    };
  }

  return {
    ok: true,
    price,
    productId: product.id,
    productName: product.name,
    mode: checkoutModeForPrice(price),
    interval: price.recurring?.interval || null
  };
}

function escapeStripeSearchValue(value: string) {
  return value.replace(/['\\]/g, "");
}

async function getStoredStripeCustomerId(writer: SupabaseClient, userId: string) {
  const result = await writer
    .from("roamly_profiles")
    .select("metadata")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) return "";
  const metadata = result.data?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const customerId = (metadata as Record<string, unknown>).stripe_customer_id;
  return typeof customerId === "string" ? customerId : "";
}

async function storeStripeCustomerId(writer: SupabaseClient, userId: string, customerId: string) {
  const existing = await writer
    .from("roamly_profiles")
    .select("metadata")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) return;
  const metadata = existing.data?.metadata && typeof existing.data.metadata === "object" && !Array.isArray(existing.data.metadata)
    ? (existing.data.metadata as Record<string, unknown>)
    : {};
  await writer
    .from("roamly_profiles")
    .update({ metadata: { ...metadata, stripe_customer_id: customerId } })
    .eq("user_id", userId);
}

async function getOrCreateStripeCustomer(
  stripe: Stripe,
  writer: SupabaseClient,
  user: { id: string; email?: string | null }
) {
  const storedCustomerId = await getStoredStripeCustomerId(writer, user.id);
  if (storedCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(storedCustomerId);
      if (!("deleted" in customer)) return customer;
    } catch {
      // Continue to metadata/email lookup if the stored customer was removed in Stripe.
    }
  }

  const byMetadata = await stripe.customers.search({
    query: `metadata['supabase_user_id']:'${escapeStripeSearchValue(user.id)}'`,
    limit: 1
  });
  if (byMetadata.data[0]) {
    await storeStripeCustomerId(writer, user.id, byMetadata.data[0].id);
    return byMetadata.data[0];
  }

  if (user.email) {
    const byEmail = await stripe.customers.list({ email: user.email, limit: 10 });
    const match = byEmail.data.find((customer) => customer.metadata?.supabase_user_id === user.id) || byEmail.data[0];
    if (match) {
      await stripe.customers.update(match.id, {
        metadata: {
          ...match.metadata,
          supabase_user_id: user.id,
          app: "roamly"
        }
      });
      await storeStripeCustomerId(writer, user.id, match.id);
      return match;
    }
  }

  const created = await stripe.customers.create({
    email: user.email || undefined,
    metadata: {
      app: "roamly",
      supabase_user_id: user.id
    }
  });
  await storeStripeCustomerId(writer, user.id, created.id);
  await recordAppEvent(writer, {
    userId: user.id,
    eventType: "stripe_customer_created",
    metadata: { customerId: created.id }
  });
  return created;
}

async function findReusablePendingCheckoutSession(
  stripe: Stripe,
  writer: SupabaseClient,
  userId: string,
  tripId: string,
  purchaseType: RoamlyPurchaseType
) {
  const pending = await writer
    .from("roamly_itinerary_purchases")
    .select("stripe_checkout_session_id")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .eq("purchase_type", purchaseType)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);

  if (pending.error) return null;

  for (const row of pending.data || []) {
    const sessionId = typeof row.stripe_checkout_session_id === "string" ? row.stripe_checkout_session_id : "";
    if (!sessionId) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === "open" && session.url) return session;
    } catch {
      // Ignore stale or deleted sessions and create a fresh one.
    }
  }

  return null;
}

function paymentIntentId(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
}

export function isTripLocked(trip: Pick<RoamlyBillingTrip, "itinerary_locked" | "itinerary_status" | "itinerary_generated_at">) {
  return Boolean(trip.itinerary_locked || trip.itinerary_status === "locked" || trip.itinerary_generated_at);
}

function isTripGenerating(trip: Pick<RoamlyBillingTrip, "itinerary_status"> & { status?: string | null }) {
  return trip.itinerary_status === "generating" || trip.status === "generating";
}

function isStaleGeneratingTrip(trip: Pick<RoamlyBillingTrip, "updated_at">) {
  if (!trip.updated_at) return false;
  const updatedAt = new Date(trip.updated_at).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > GENERATING_STALE_AFTER_MS;
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
  if (isTripGenerating(trip) && !isStaleGeneratingTrip(trip)) {
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
  const priceValidation = await validateStripePriceForPurchase(stripe, purchaseType);
  if (!priceValidation.ok) return priceValidation;
  const writer = createSupabaseAdminClient() || supabase;
  const reusable = await findReusablePendingCheckoutSession(stripe, writer, user.id, tripId, purchaseType);
  if (reusable?.url) return { ok: true as const, url: reusable.url, sessionId: reusable.id, reused: true as const };

  const customer = await getOrCreateStripeCustomer(stripe, writer, user);
  const metadata = {
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
  };

  const idempotencyWindow = Math.floor(Date.now() / 60_000);
  const session = await stripe.checkout.sessions.create({
    mode: priceValidation.mode,
    customer: customer.id,
    client_reference_id: `${user.id}:${tripId}:${purchaseType}`,
    line_items: [{ price: priceValidation.price.id, quantity: 1 }],
    success_url: getCheckoutSuccessUrl(tripId),
    cancel_url: `${roamlyConfig.appUrl}/trip/${tripId}?checkout=cancelled`,
    metadata,
    payment_intent_data:
      priceValidation.mode === "payment"
        ? {
            metadata
          }
        : undefined,
    subscription_data:
      priceValidation.mode === "subscription"
        ? {
            metadata
          }
        : undefined,
    allow_promotion_codes: true
  }, {
    idempotencyKey: `roamly_checkout_${user.id}_${tripId}_${purchaseType}_${idempotencyWindow}`
  });

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

  await recordAppEvent(writer, {
    userId: user.id,
    eventType: "stripe_checkout_session_created",
    metadata: {
      tripId,
      purchaseType,
      checkoutSessionId: session.id,
      checkoutMode: priceValidation.mode,
      priceEnvName: option.envName,
      stripeMode: getStripeSecretMode()
    }
  });

  return { ok: true as const, url: session.url, sessionId: session.id, reused: false as const };
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
        tracking_paid_at: new Date().toISOString()
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
    .select("id,user_id,itinerary_locked,itinerary_status,itinerary_generated_at,tracking_unlocked")
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

export async function createBillingPortalSession(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null }
) {
  const stripe = createStripeClient();
  if (!stripe) return { ok: false as const, status: 503, error: "Stripe billing portal needs STRIPE_SECRET_KEY." };
  const writer = createSupabaseAdminClient() || supabase;
  const customer = await getOrCreateStripeCustomer(stripe, writer, user);
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: `${roamlyConfig.appUrl}/dashboard?billing=returned`
  });
  return { ok: true as const, url: session.url };
}

async function hasProcessedStripeEvent(supabase: SupabaseClient, eventId: string) {
  const existing = await supabase
    .from("roamly_app_events")
    .select("id")
    .eq("event_type", "stripe_webhook_event_processed")
    .contains("metadata", { stripe_event_id: eventId })
    .limit(1)
    .maybeSingle();
  if (existing.error) return false;
  return Boolean(existing.data);
}

async function markStripeEventProcessed(
  supabase: SupabaseClient,
  event: Stripe.Event,
  metadata: Record<string, unknown> = {}
) {
  await recordAppEvent(supabase, {
    userId: typeof metadata.userId === "string" ? metadata.userId : null,
    eventType: "stripe_webhook_event_processed",
    metadata: {
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      stripe_mode: event.livemode ? "live" : "test",
      ...metadata
    }
  });
}

function checkoutSessionFromEvent(event: Stripe.Event) {
  return event.data.object as Stripe.Checkout.Session;
}

function subscriptionFromEvent(event: Stripe.Event) {
  return event.data.object as Stripe.Subscription;
}

function invoiceFromEvent(event: Stripe.Event) {
  return event.data.object as Stripe.Invoice;
}

async function markCheckoutSessionExpired(supabase: SupabaseClient, session: Stripe.Checkout.Session) {
  await supabase
    .from("roamly_itinerary_purchases")
    .update({
      status: "expired",
      metadata: { stripe_status: session.status, expired_at: new Date().toISOString() }
    })
    .eq("stripe_checkout_session_id", session.id);
  await supabase
    .from("roamly_trip_payments")
    .update({ status: "expired" })
    .eq("stripe_session_id", session.id);
  return { ok: true as const };
}

async function recordSubscriptionWebhook(supabase: SupabaseClient, event: Stripe.Event) {
  const subscription = subscriptionFromEvent(event);
  const userId = subscription.metadata?.user_id || subscription.metadata?.userId || null;
  const tripId = subscription.metadata?.trip_id || subscription.metadata?.tripId || null;
  const purchaseType = normalizePurchaseType(subscription.metadata?.purchase_type || subscription.metadata?.checkoutKind);

  await recordAppEvent(supabase, {
    userId,
    eventType: "stripe_subscription_sync",
    metadata: {
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
      stripe_status: subscription.status,
      tripId,
      purchaseType
    }
  });

  if (tripId && userId && (subscription.status === "canceled" || subscription.status === "unpaid" || subscription.status === "incomplete_expired")) {
    await supabase
      .from("roamly_itinerary_purchases")
      .update({
        metadata: {
          stripe_subscription_id: subscription.id,
          stripe_subscription_status: subscription.status,
          synced_at: new Date().toISOString()
        }
      })
      .eq("user_id", userId)
      .eq("trip_id", tripId)
      .eq("purchase_type", purchaseType);
  }

  return { ok: true as const };
}

async function recordInvoiceWebhook(supabase: SupabaseClient, event: Stripe.Event) {
  const invoice = invoiceFromEvent(event);
  await recordAppEvent(supabase, {
    userId: null,
    eventType: "stripe_invoice_sync",
    metadata: {
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      stripe_invoice_id: invoice.id,
      stripe_customer_id: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id,
      stripe_status: invoice.status,
      stripe_paid: (invoice as Stripe.Invoice & { paid?: boolean }).paid === true
    }
  });
  return { ok: true as const };
}

async function recordPaymentIntentWebhook(
  supabase: SupabaseClient,
  event: Stripe.Event
) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  await recordAppEvent(supabase, {
    userId:
      typeof paymentIntent.metadata?.user_id === "string"
        ? paymentIntent.metadata.user_id
        : null,
    eventType:
      event.type === "payment_intent.succeeded"
        ? "stripe_payment_succeeded"
        : "stripe_payment_failed",
    metadata: {
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_customer_id:
        typeof paymentIntent.customer === "string"
          ? paymentIntent.customer
          : paymentIntent.customer?.id || null,
      trip_id:
        paymentIntent.metadata?.trip_id ||
        paymentIntent.metadata?.tripId ||
        null,
      purchase_type:
        paymentIntent.metadata?.purchase_type ||
        paymentIntent.metadata?.purchaseType ||
        null,
      amount: paymentIntent.amount,
      amount_received: paymentIntent.amount_received,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      failure_code: paymentIntent.last_payment_error?.code || null
    }
  });

  return { ok: true as const };
}

export async function handleStripeWebhookEvent(supabase: SupabaseClient, event: Stripe.Event) {
  if (await hasProcessedStripeEvent(supabase, event.id)) {
    return { ok: true as const, duplicate: true as const };
  }

  let result: { ok: boolean; error?: string; purchaseType?: RoamlyPurchaseType } = { ok: true };
  const metadata: Record<string, unknown> = {};

  if (event.type === "checkout.session.completed") {
    const session = checkoutSessionFromEvent(event);
    metadata.checkoutSessionId = session.id;
    metadata.userId = session.metadata?.user_id || session.metadata?.userId || null;
    metadata.tripId = session.metadata?.trip_id || session.metadata?.tripId || null;
    result = await applyPaidItineraryPurchase(supabase, session);
  } else if (event.type === "checkout.session.expired") {
    const session = checkoutSessionFromEvent(event);
    metadata.checkoutSessionId = session.id;
    metadata.userId = session.metadata?.user_id || session.metadata?.userId || null;
    metadata.tripId = session.metadata?.trip_id || session.metadata?.tripId || null;
    result = await markCheckoutSessionExpired(supabase, session);
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    result = await recordSubscriptionWebhook(supabase, event);
  } else if (
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.payment_failed"
  ) {
    result = await recordInvoiceWebhook(supabase, event);
  } else if (
    event.type === "payment_intent.succeeded" ||
    event.type === "payment_intent.payment_failed"
  ) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    metadata.paymentIntentId = paymentIntent.id;
    metadata.userId =
      paymentIntent.metadata?.user_id ||
      paymentIntent.metadata?.userId ||
      null;
    metadata.tripId =
      paymentIntent.metadata?.trip_id ||
      paymentIntent.metadata?.tripId ||
      null;

    result = await recordPaymentIntentWebhook(supabase, event);
  }

  if (!result.ok) return result;
  await markStripeEventProcessed(supabase, event, metadata);
  return { ok: true as const, duplicate: false as const };
}

export async function getStripeBillingDiagnostics() {
  const stripe = createStripeClient();
  const configured = {
    STRIPE_SECRET_KEY: Boolean(process.env.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    ROAMLY_STRIPE_ITINERARY_PRICE_ID: Boolean(roamlyConfig.itineraryUnlockPriceId),
    ROAMLY_STRIPE_FEATURES_PRICE_ID: Boolean(roamlyConfig.trackingAddonPriceId),
    ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID: Boolean(roamlyConfig.tripBundlePriceId)
  };

  if (!stripe) {
    return {
      configured,
      stripeMode: getStripeSecretMode(),
      prices: []
    };
  }

  const prices = await Promise.all(
    (Object.keys(purchaseOptions) as RoamlyPurchaseType[]).map(async (purchaseType) => {
      const option = getPurchaseOption(purchaseType);
      const validation = await validateStripePriceForPurchase(stripe, purchaseType);
      if (!validation.ok) {
        return {
          purchaseType,
          envName: option.envName,
          configured: Boolean(option.priceId),
          ok: false,
          error: validation.error,
          message: validation.message
        };
      }
      return {
        purchaseType,
        envName: option.envName,
        configured: true,
        ok: true,
        active: validation.price.active,
        productActive: true,
        amountMatches: validation.price.unit_amount === option.amount,
        currencyMatches: validation.price.currency === roamlyConfig.currency,
        mode: validation.mode,
        interval: validation.interval,
        productName: validation.productName
      };
    })
  );

  return {
    configured,
    stripeMode: getStripeSecretMode(),
    prices
  };
}
