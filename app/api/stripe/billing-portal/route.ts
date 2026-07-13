import { NextResponse } from "next/server";
import { createBillingPortalSession } from "@/lib/roamly/billing";
import { requireUser } from "@/lib/roamly/auth";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

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
