import { NextResponse } from "next/server";
import { createBillingPortalSession } from "@/lib/roamly/billing";
import { requireUser } from "@/lib/roamly/auth";
import {
  STEP_UP_ERROR_CODE,
  STEP_UP_REQUIRED_MESSAGE,
  requireFreshAuthentication
} from "@/lib/roamly/stepUp";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // Step-up (Stage 5, 2026-11-11): the billing portal can change the
  // payment method or cancel the plan, so a merely-present session is
  // not enough — the sign-in must be fresh (see lib/roamly/stepUp.ts).
  const stepUp = await requireFreshAuthentication(auth.supabase, auth.user);
  if (!stepUp.ok) {
    return NextResponse.json(
      { ok: false, error: STEP_UP_ERROR_CODE, message: STEP_UP_REQUIRED_MESSAGE },
      { status: 403 }
    );
  }

  try {
    const portal = await createBillingPortalSession(auth.supabase, auth.user);
    if (!portal.ok) {
      return NextResponse.json({ ok: false, error: portal.error }, { status: portal.status || 500 });
    }
    return NextResponse.json({ ok: true, url: portal.url });
  } catch (error) {
    console.error("[Roamly] Billing portal failed", {
      userId: auth.user.id,
      error: error instanceof Error ? error.message : "Unknown billing portal error"
    });
    return NextResponse.json(
      { ok: false, error: "BILLING_PORTAL_FAILED", message: "Billing management could not be opened." },
      { status: 500 }
    );
  }
}
