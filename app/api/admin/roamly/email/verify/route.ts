import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { verifyRoamlyEmailProvider } from "@/lib/roamly/email";

function hasValidServerSecret(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();

  const allowed = [
    process.env.ROAMLY_EMAIL_VERIFY_SECRET,
    process.env.ROAMLY_GENERATION_CRON_SECRET,
    process.env.ROAMLY_NOTIFICATION_CRON_SECRET,
    process.env.CRON_SECRET
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  return Boolean(token && allowed.includes(token));
}

export async function POST(request: NextRequest) {
  if (!hasValidServerSecret(request)) {
    const guard = await requireRoamlyAdmin();
    if (!guard.ok) return guard.response;
  }

  const result = await verifyRoamlyEmailProvider();
  return NextResponse.json(
    { ok: result.ok, result },
    { status: result.ok ? 200 : 400 }
  );
}
