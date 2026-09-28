import { NextRequest, NextResponse } from "next/server";
import { createStripeClient } from "@/lib/payments";
import { handleStripeWebhookEvent } from "@/lib/roamly/billing";
import { operationalOpaqueId, recordOperationalEvent, safeOperationalError } from "@/lib/roamly/operationalIncidents";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  stripeWebhookPreVerificationIncident,
  STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES
} from "@/lib/roamly/stripeWebhookDiagnostics";

function recordPreVerificationIncident(failure: keyof typeof STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES) {
  const incident = stripeWebhookPreVerificationIncident(STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES[failure]);
  void recordOperationalEvent({
    severity: incident.severity,
    subsystem: "billing",
    eventCode: incident.eventCode,
    fingerprintParts: incident.fingerprintParts,
    eventKey: incident.eventKey,
    correlationId: incident.correlationId,
    safeMetadata: incident.safeMetadata
  }).catch(() => {
    console.warn("[Roamly] Stripe webhook diagnostic unavailable", { eventCode: incident.eventCode });
  });
}

export async function POST(request: NextRequest) {
  const stripe = createStripeClient();
  const supabase = createSupabaseAdminClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !supabase || !webhookSecret) {
    recordPreVerificationIncident("configurationMissing");
    return NextResponse.json({ ok: false, error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    recordPreVerificationIncident("signatureMissing");
    return NextResponse.json({ ok: false, error: "Missing Stripe signature." }, { status: 400 });
  }

  const rawBody = await request.text();
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    recordPreVerificationIncident("signatureVerificationFailed");
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid Stripe webhook." },
      { status: 400 }
    );
  }

  const result = await handleStripeWebhookEvent(supabase, event);
  if (!result.ok) {
    void recordOperationalEvent({
      severity: "high",
      subsystem: "billing",
      eventCode: "stripe_webhook_processing_failed",
      fingerprintParts: ["stripe_webhook", event.type, "processing_failure"],
      eventKey: operationalOpaqueId(["stripe", event.id, "processing_failure"]),
      correlationId: operationalOpaqueId(["stripe-correlation", event.id]),
      safeMetadata: { operation: "stripe_webhook", stage: "handler", ...safeOperationalError(result.error) }
    });
    console.error("[Roamly] Stripe webhook sync failed", {
      eventType: event.type,
      eventId: event.id,
      error: result.error
    });
    return NextResponse.json({ ok: false, error: "Stripe webhook sync failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
