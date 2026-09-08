import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRoamlySupportEmail, sendRoamlyEmail } from "@/lib/roamly/email";
import { claimCommunication, completeCommunication, failCommunication } from "@/lib/roamly/communicationOrchestration";
import type { RoamlyPurchaseType } from "@/lib/roamly/billing";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { buildPurchaseActivationEmailModel } from "@/lib/roamly/purchaseActivationContent";
import { roamlyConfig } from "@/lib/env";
import { renderEmailBodyCopy, renderRoamlyEmailShell, toRoamlyAbsoluteUrl } from "@/lib/roamly/emailTemplates";

type PurchaseActivationParams = {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  checkoutSessionId: string;
  purchaseType: RoamlyPurchaseType;
};

function activePurchase(purchase: Record<string, unknown> | null) {
  return Boolean(
    purchase &&
      purchase.status === "paid" &&
      ["active", "partially_refunded"].includes(typeof purchase.billing_state === "string" ? purchase.billing_state : "active")
  );
}

function featuresForPurchase(purchaseType: RoamlyPurchaseType) {
  if (purchaseType === "itinerary_unlock") return ["Custom itinerary planning"];
  if (purchaseType === "tracking_addon") return ["Live Trip Companion"];
  return ["Custom itinerary planning", "Live Trip Companion"];
}

export async function sendPurchaseActivationCommunication(params: PurchaseActivationParams) {
  const db = createSupabaseAdminClient() || params.supabase;
  const resolvedPurchase = await db
    .from("roamly_itinerary_purchases")
    .select("id,status,billing_state,stripe_checkout_session_id")
    .eq("stripe_checkout_session_id", params.checkoutSessionId)
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .maybeSingle();
  if (resolvedPurchase.error || !activePurchase(resolvedPurchase.data as Record<string, unknown> | null)) {
    return { ok: true as const, sent: false as const, suppressed: "PURCHASE_NOT_ACTIVE" as const };
  }

  const [{ data: userResult }, tripResult, gmailResult] = await Promise.all([
    db.auth.admin.getUserById(params.userId),
    db
      .from("roamly_trips")
      .select("id,user_id,title,destination_name,start_date,end_date,tracking_unlocked,live_companion_unlocked,metadata")
      .eq("id", params.tripId)
      .eq("user_id", params.userId)
      .maybeSingle(),
    db
      .from("email_connections")
      .select("connection_status")
      .eq("user_id", params.userId)
      .eq("provider", "gmail")
      .maybeSingle()
  ]);
  const trip = tripResult.data as Record<string, unknown> | null;
  const recipient = userResult.user?.email?.trim() || "";
  if (tripResult.error || !trip || !recipient) {
    return { ok: true as const, sent: false as const, suppressed: "PURCHASE_CONTACT_UNAVAILABLE" as const };
  }

  const claim = await claimCommunication({
    supabase: db,
    userId: params.userId,
    tripId: params.tripId,
    purpose: "purchase_confirmation",
    occurrenceKey: params.checkoutSessionId,
    preferredChannel: "email",
    metadata: { purpose: "purchase_activation", source: "stripe_checkout_completed", template: "purchase_activation" }
  });
  if (!claim.ok || !claim.claimed || !claim.communicationId || !claim.claimToken) {
    return { ok: claim.ok, sent: false as const, status: claim.status };
  }

  const latestPurchase = await db
    .from("roamly_itinerary_purchases")
    .select("status,billing_state")
    .eq("id", (resolvedPurchase.data as { id: string }).id)
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .maybeSingle();
  if (latestPurchase.error || !activePurchase(latestPurchase.data as Record<string, unknown> | null)) {
    await failCommunication({
      supabase: db,
      communicationId: claim.communicationId,
      claimToken: claim.claimToken,
      errorCode: "PURCHASE_INVALIDATED_BEFORE_SEND",
      retryable: false
    });
    return { ok: true as const, sent: false as const, suppressed: "PURCHASE_INVALIDATED_BEFORE_SEND" as const };
  }

  const liveCompanion = params.purchaseType === "itinerary_unlock"
    ? "Not included" as const
    : trip.tracking_unlocked === true || trip.live_companion_unlocked === true
      ? "Included and activated" as const
      : "Not included" as const;
  const model = buildPurchaseActivationEmailModel({
    destination: getTripDestinationLabel(trip),
    startDate: typeof trip.start_date === "string" ? trip.start_date : null,
    endDate: typeof trip.end_date === "string" ? trip.end_date : null,
    features: featuresForPurchase(params.purchaseType),
    liveCompanion,
    gmailStatus: gmailResult.error ? null : gmailResult.data?.connection_status === "connected" ? "Connected" : "Not connected",
    tripId: params.tripId,
    appUrl: roamlyConfig.appUrl
  });
  const rendered = renderRoamlyEmailShell({
    subject: model.subject,
    preheader: model.preheader,
    eyebrow: model.eyebrow,
    title: model.title,
    intro: model.intro,
    bodyHtml: renderEmailBodyCopy(model.bodyText),
    bodyText: model.bodyText,
    summaryItems: model.summaryItems,
    ctaLabel: model.ctaLabel,
    ctaUrl: toRoamlyAbsoluteUrl(model.tripPath, model.appUrl || undefined),
    supportEmail: getRoamlySupportEmail()
  });
  const result = await sendRoamlyEmail({
    to: recipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    userId: params.userId,
    tripId: params.tripId,
    idempotencyKey: claim.communicationId,
    metadata: { purpose: "purchase_activation", template: "purchase_activation" }
  });
  if (result.ok) {
    await completeCommunication({
      supabase: db,
      communicationId: claim.communicationId,
      claimToken: claim.claimToken,
      provider: result.provider,
      providerMessageId: result.providerMessageId
    });
    return { ok: true as const, sent: true as const };
  }

  await failCommunication({
    supabase: db,
    communicationId: claim.communicationId,
    claimToken: claim.claimToken,
    errorCode: result.provider === "smtp" ? "SMTP_ACCEPTANCE_UNCERTAIN" : "PURCHASE_ACTIVATION_EMAIL_FAILED",
    retryable: result.retryable === true,
    uncertainAcceptance: result.provider === "smtp"
  });
  return { ok: true as const, sent: false as const, status: "failed" as const };
}
