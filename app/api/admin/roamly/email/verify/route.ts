import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { verifyRoamlyEmailProvider } from "@/lib/roamly/email";

export async function POST() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const result = await verifyRoamlyEmailProvider();
  return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : 400 });
}
