import { NextRequest, NextResponse } from "next/server";
import {
  GUEST_ITINERARY_COOKIE,
  guestItineraryCookieOptions,
  signGuestItineraryCookie
} from "@/lib/roamly/guestItineraryAccess";
import {
  guestRecoveryUrl,
  isValidGuestDeliveryEmail,
  normalizeGuestDeliveryEmail,
  signGuestRecoveryToken,
  verifyGuestRecoveryToken
} from "@/lib/roamly/guestDelivery";
import { guestFreeItineraryEntitlement } from "@/lib/roamly/guestItineraryView";
import { sendRoamlyEmail } from "@/lib/roamly/email";
import { consumeRecoveryEmailQuota, emailSendActorHash } from "@/lib/roamly/emailSendQuota";
import { trustedContactClientIp } from "@/lib/roamly/contactRequestSecurity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
 * Guest magic-link recovery (owner law, 2026-10-24): a traveler who lost
 * the browser cookie gets their free itinerary back by email.
 *
 * POST { email } — always answers the same generic line, whether or not
 * the email holds a trip, so one email address cannot be probed for
 * trips. When a guest trip is found, a signed 30-day link goes out.
 * Sends are cooled down per address and per caller IP (security pass
 * 2026-11-06, Check 5): at most one recovery email per address per hour,
 * enforced in the database; a cooled-down request gets the same generic
 * line and sends nothing.
 * GET ?token= — verifies the link, restores the 7-day cookie, and sends
 * the traveler to their itinerary. The link never reveals anything to a
 * third party beyond the itinerary itself (no payment data, no account).
 */

const GENERIC_REPLY = "If that email has a free itinerary, a link is on its way to it.";

function unavailable() {
  return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE" }, { status: 503 });
}

async function findGuestTripByEmail(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  email: string
) {
  const { data: candidates, error } = await admin
    .from("roamly_trips")
    .select("id,user_id,title,destination_name,status,itinerary_status,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,live_companion_unlocked,metadata")
    .filter("metadata->>guestDeliveryEmail", "eq", email);
  if (error || !candidates) return null;
  for (const trip of candidates) {
    const owner = await admin.auth.admin.getUserById(trip.user_id);
    if (owner.data.user?.user_metadata?.roamly_guest_itinerary !== true) continue;
    if (!guestFreeItineraryEntitlement(trip).allowed) continue;
    return trip;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const rawEmail = typeof body?.email === "string" ? body.email : "";
  // Generic reply even for a malformed address: nothing about the email
  // can be probed through this endpoint.
  if (!isValidGuestDeliveryEmail(rawEmail)) {
    return NextResponse.json({ ok: true, message: GENERIC_REPLY });
  }
  const email = normalizeGuestDeliveryEmail(rawEmail);

  const admin = createSupabaseAdminClient();
  if (!admin) return unavailable();

  const trip = await findGuestTripByEmail(admin, email);
  if (!trip) {
    return NextResponse.json({ ok: true, message: GENERIC_REPLY });
  }

  // Cooldown (security pass 2026-11-06, Check 5): one recovery email per
  // address per hour (5/day backstop), and the same per caller IP,
  // recorded in the database (migration 20261106000200). Quota is consumed
  // only when a send is about to happen; a denied or unavailable quota
  // returns the SAME generic reply and sends nothing, so the cooldown
  // can never reveal whether an address holds a trip.
  const quotaSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const emailActorHash = emailSendActorHash("recovery-email", email, quotaSecret);
  const clientIp = trustedContactClientIp(request.headers.get("x-forwarded-for"));
  const ipActorHash = clientIp ? emailSendActorHash("recovery-ip", clientIp, quotaSecret) : null;
  let sendAllowed = Boolean(emailActorHash);
  let quotaError = !emailActorHash;
  if (sendAllowed) {
    for (const actorHash of [emailActorHash, ipActorHash]) {
      if (!actorHash) continue;
      const quota = await consumeRecoveryEmailQuota(admin, actorHash);
      if (!quota.ok) quotaError = true;
      if (!quota.ok || !quota.allowed) {
        sendAllowed = false;
        break;
      }
    }
  }
  if (!sendAllowed) {
    if (quotaError) {
      console.error("[Roamly guest recovery] Recovery quota unavailable; email not sent.");
    }
    return NextResponse.json({ ok: true, message: GENERIC_REPLY });
  }

  const token = signGuestRecoveryToken(trip.id, trip.user_id);
  if (!token) return unavailable();
  const link = guestRecoveryUrl(token);
  const title = typeof trip.title === "string" && trip.title.trim() ? trip.title.trim() : "your free itinerary";
  await sendRoamlyEmail({
    to: email,
    subject: "Get your Roamly itinerary back",
    text: `You asked to get your free Roamly itinerary back.\n\nOpen this link to see ${title} again:\n${link}\n\nThe link works for 30 days. If you didn't ask for this, just ignore it — nothing changes.`,
    html: `<p>You asked to get your free Roamly itinerary back.</p><p><a href="${link}">Open ${title} again</a></p><p>The link works for 30 days. If you didn't ask for this, just ignore it — nothing changes.</p>`,
    tripId: trip.id
  }).catch(() => null);

  return NextResponse.json({ ok: true, message: GENERIC_REPLY });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const access = verifyGuestRecoveryToken(token);
  if (!access) {
    return NextResponse.redirect(new URL("/plan?guestRecovery=failed", request.url));
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return unavailable();

  const guestUser = await admin.auth.admin.getUserById(access.userId);
  if (guestUser.data.user?.user_metadata?.roamly_guest_itinerary !== true) {
    return NextResponse.redirect(new URL("/plan?guestRecovery=failed", request.url));
  }
  const { data: trip, error } = await admin
    .from("roamly_trips")
    .select("id,user_id,status,itinerary_status,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,live_companion_unlocked,metadata")
    .eq("id", access.tripId)
    .eq("user_id", access.userId)
    .maybeSingle();
  if (error || !trip || !guestFreeItineraryEntitlement(trip).allowed) {
    return NextResponse.redirect(new URL("/plan?guestRecovery=failed", request.url));
  }

  const cookie = signGuestItineraryCookie(access.tripId, access.userId);
  if (!cookie) {
    return NextResponse.redirect(new URL("/plan?guestRecovery=failed", request.url));
  }
  const response = NextResponse.redirect(new URL("/plan/itinerary", request.url));
  response.cookies.set(GUEST_ITINERARY_COOKIE, cookie, guestItineraryCookieOptions());
  return response;
}
