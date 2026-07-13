import { NextResponse } from "next/server";
import { getStripeBillingDiagnostics } from "@/lib/roamly/billing";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  try {
    const diagnostics = await getStripeBillingDiagnostics();
    return NextResponse.json({ ok: true, diagnostics });
  } catch (error) {
    console.error("[Roamly admin] Stripe diagnostics failed", {
      userId: guard.user.id,
      error: error instanceof Error ? error.message : "Unknown Stripe diagnostics error"
    });
    return NextResponse.json(
      { ok: false, error: "STRIPE_DIAGNOSTICS_FAILED", message: "Stripe diagnostics could not complete." },
      { status: 500 }
    );
  }
}
