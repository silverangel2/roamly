import { NextRequest, NextResponse } from "next/server";
import { applyPaidCheckoutSession, createStripeClient } from "@/lib/payments";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const stripe = createStripeClient();
  const supabase = createSupabaseAdminClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !supabase || !webhookSecret) {
    return NextResponse.json({ ok: false, error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ ok: false, error: "Missing Stripe signature." }, { status: 400 });

  const rawBody = await request.text();
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid Stripe webhook." },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const result = await applyPaidCheckoutSession(session);
    if (!result.ok) console.error("[Roamly] Stripe webhook checkout sync failed", result.error);
  }

  return NextResponse.json({ ok: true });
}
