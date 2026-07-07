import { NextRequest, NextResponse } from "next/server";
import { createCompleteTripCheckoutSession } from "@/lib/roamly/billing";
import { requireUser } from "@/lib/roamly/auth";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const checkout = await createCompleteTripCheckoutSession(auth.supabase, auth.user, tripId);
  if (!checkout.ok) {
    return NextResponse.json(
      { ok: false, error: checkout.error, message: "message" in checkout ? checkout.message : undefined },
      { status: checkout.status || 500 }
    );
  }

  return NextResponse.json({ ok: true, url: checkout.url });
}
