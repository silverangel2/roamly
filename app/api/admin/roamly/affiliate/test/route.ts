import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { testAffiliateLinks } from "@/lib/roamly/affiliateResolver";

export async function POST() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  return NextResponse.json({ ok: true, result: testAffiliateLinks() });
}
