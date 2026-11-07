import {
  applyPaidItineraryPurchase,
  getCheckoutSuccessUrl,
  getPurchaseOption,
  normalizePurchaseType,
  type RoamlyPurchaseType
} from "@/lib/roamly/billing";
import { createStripeClient } from "@/lib/stripe";

export type RoamlyCheckoutKind = "itinerary" | "features" | "complete";

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

export type ConfirmedCheckoutPurchase = {
  /** Display name of the product actually bought (server-side record). */
  productName: string;
  /** Amount + currency actually charged, e.g. "CAD $7.99". */
  amountLabel: string;
  /** Stripe-hosted receipt URL for the charge, when Stripe issued one. */
  receiptUrl?: string;
};

function formatChargedAmount(amountTotal: number | null, currency: string | null): string {
  if (amountTotal == null) return "";
  const cur = (currency || "cad").toUpperCase();
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: cur }).format(amountTotal / 100);
  } catch {
    return `${cur} $${(amountTotal / 100).toFixed(2)}`;
  }
}

export async function confirmCheckoutSessionForTrip(params: {
  sessionId: string;
  tripId: string;
  userId: string;
}): Promise<
  | { ok: false; error: string }
  | { ok: true; awaitingWebhook: boolean; purchase: ConfirmedCheckoutPurchase }
> {
  const stripe = createStripeClient();
  if (!stripe) return { ok: false, error: "Stripe is not configured." };

  // The confirmation panel (checkout-success fix, 2026-11-06) is
  // built ONLY from this server-confirmed session: the charge is
  // expanded so the amount actually charged and the Stripe receipt
  // URL come from Stripe's record, never from the return URL.
  const session = await stripe.checkout.sessions.retrieve(params.sessionId, {
    expand: ["payment_intent.latest_charge"]
  });
  const tripId = session.metadata?.trip_id || session.metadata?.tripId;
  const userId = session.metadata?.user_id || session.metadata?.userId;

  if (tripId !== params.tripId || userId !== params.userId) {
    return { ok: false, error: "Checkout session does not match this trip." };
  }

  if (session.payment_status !== "paid") {
    return { ok: false, error: "Stripe has not marked this checkout as paid yet." };
  }

  // Apply the purchase immediately on the return path so the trip page
  // reflects payment without waiting for the webhook round trip. Idempotent:
  // the webhook converges on the same ledger rows if it arrives first or later.
  const applied = await applyPaidCheckoutSession(session);
  if (!applied.ok) {
    console.error("[Roamly trip] Checkout return-path apply failed; waiting for webhook", {
      tripId: params.tripId,
      userId: params.userId,
      error: applied.error
    });
  }

  const purchaseType = normalizePurchaseType(session.metadata?.purchase_type || session.metadata?.checkoutKind);
  const option = getPurchaseOption(purchaseType);
  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const latestCharge = paymentIntent && typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
  const purchase: ConfirmedCheckoutPurchase = {
    productName: option.name,
    amountLabel: formatChargedAmount(session.amount_total, session.currency),
    ...(latestCharge?.receipt_url ? { receiptUrl: latestCharge.receipt_url } : {})
  };

  return { ok: true, awaitingWebhook: !applied.ok, purchase };
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
