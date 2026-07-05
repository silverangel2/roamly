import {
  applyPaidItineraryPurchase,
  getCheckoutSuccessUrl,
  getPurchaseOption,
  normalizePurchaseType,
  tripHasTrackingUnlock,
  type RoamlyPurchaseType
} from "@/lib/roamly/billing";
import { createStripeClient } from "@/lib/stripe";

export type RoamlyCheckoutKind = "itinerary" | "features" | "complete";

type TripPaymentState = {
  is_activated?: boolean | null;
  itinerary_locked?: boolean | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

function mapCheckoutKind(kind: RoamlyCheckoutKind): RoamlyPurchaseType {
  if (kind === "itinerary") return "itinerary_unlock";
  if (kind === "features") return "tracking_addon";
  return "bundle";
}

export { createStripeClient, getCheckoutSuccessUrl };

export function normalizeCheckoutKind(value: unknown): RoamlyCheckoutKind {
  if (value === "itinerary" || value === "features" || value === "complete") return value;
  if (value === "itinerary_unlock") return "itinerary";
  if (value === "tracking_addon") return "features";
  return "complete";
}

export function getCheckoutOption(kind: RoamlyCheckoutKind) {
  return getPurchaseOption(mapCheckoutKind(kind));
}

export function tripHasFeatureUnlock(trip: TripPaymentState) {
  if (tripHasTrackingUnlock(trip)) return true;

  const metadata = trip.metadata && typeof trip.metadata === "object" ? trip.metadata : {};
  return Boolean(metadata.features_unlocked === true || metadata.roamly_paid_plan === "complete_pack");
}

export async function confirmCheckoutSessionForTrip(params: {
  sessionId: string;
  tripId: string;
  userId: string;
}) {
  const stripe = createStripeClient();
  if (!stripe) return { ok: false, error: "Stripe is not configured." };

  const session = await stripe.checkout.sessions.retrieve(params.sessionId);
  const tripId = session.metadata?.trip_id || session.metadata?.tripId;
  const userId = session.metadata?.user_id || session.metadata?.userId;

  if (tripId !== params.tripId || userId !== params.userId) {
    return { ok: false, error: "Checkout session does not match this trip." };
  }

  return applyPaidCheckoutSession(session);
}

export async function applyPaidCheckoutSession(session: Parameters<typeof applyPaidItineraryPurchase>[1]) {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, error: "Supabase service role is not configured." };

  const purchaseType = normalizePurchaseType(session.metadata?.purchase_type || session.metadata?.checkoutKind);
  return applyPaidItineraryPurchase(supabase, {
    ...session,
    metadata: {
      ...session.metadata,
      purchase_type: purchaseType
    }
  });
}
