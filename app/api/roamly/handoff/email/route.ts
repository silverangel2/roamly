import { NextRequest, NextResponse } from "next/server";
import { build2GatesEnabled } from "@/lib/roamly/build2Flags";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connectedGmailAddress } from "@/lib/roamly/gateService";
import { sendRoamlyEmail } from "@/lib/roamly/email";
import {
  createSupabaseHandoffStore,
  handoffConfigured,
  mintHandoffPass
} from "@/lib/roamly/handoffTokens";
import type { UtcInstant } from "@/lib/roamly/engine/time";

export const runtime = "nodejs";

/**
 * POST /api/roamly/handoff/email { tripId }
 * The emailed-link fallback (owner, 2026-10-21 19:15 + 19:16 ADT):
 * the SAME one-time pass design, sent to the connected Gmail — the
 * only mailbox Build 2 knows. No connected Gmail → no email, plainly.
 */
export async function POST(request: NextRequest) {
  if (!build2GatesEnabled()) {
    return NextResponse.json({ ok: false, error: "GATES_DISABLED" }, { status: 404 });
  }
  if (!handoffConfigured()) {
    return NextResponse.json({ ok: false, error: "HANDOFF_NOT_CONFIGURED" }, { status: 503 });
  }
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { tripId?: unknown };
  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  if (!tripId) return NextResponse.json({ ok: false, error: "TRIP_ID_REQUIRED" }, { status: 400 });

  const { data: trip } = await auth.supabase
    .from("roamly_trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });

  const gmailAddress = await connectedGmailAddress(auth.supabase, auth.user.id);
  if (!gmailAddress) {
    return NextResponse.json(
      {
        ok: false,
        error: "GMAIL_NOT_CONNECTED",
        message: "Connect your Gmail first — the emailed link goes to your connected Gmail, the only mailbox Roamly sends it to."
      },
      { status: 409 }
    );
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "HANDOFF_NOT_CONFIGURED" }, { status: 503 });

  try {
    const minted = await mintHandoffPass(createSupabaseHandoffStore(admin), {
      userId: auth.user.id,
      tripId,
      origin: request.nextUrl.origin,
      now: new Date().toISOString() as UtcInstant
    });
    const result = await sendRoamlyEmail({
      to: gmailAddress,
      subject: "Take your Roamly trip with you",
      text: [
        "Your trip is ready — take it with you.",
        "",
        "Open this link on your phone to land on your trip:",
        minted.url,
        "",
        "The link works once and expires in 10 minutes. If it has expired, open Roamly on your computer and choose “Take this trip with you” to get a fresh code."
      ].join("\n")
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "EMAIL_SEND_FAILED", message: result.error || "The email could not be sent." }, { status: 502 });
    }
    const [local, domain] = gmailAddress.split("@");
    const masked = local && domain ? `${local.slice(0, 2)}•••@${domain}` : "your Gmail";
    return NextResponse.json({ ok: true, sentTo: masked, expiresAt: minted.record.expiresAt });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "HANDOFF_EMAIL_FAILED", message: error instanceof Error ? error.message : "Could not email the handoff link." },
      { status: 500 }
    );
  }
}
