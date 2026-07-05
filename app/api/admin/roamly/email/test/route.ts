import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { sendTestEmail } from "@/lib/roamly/email";

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : guard.user.email || "";
  const result = await sendTestEmail({ to });
  return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : result.status === "skipped" ? 202 : 400 });
}
