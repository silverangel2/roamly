import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeAffiliateConversionEvent,
  recordAffiliateConversion,
  verifyAffiliateWebhookSignature
} from "@/lib/roamly/affiliateTracking";

export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.ROAMLY_AFFILIATE_WEBHOOK_SECRET;
  const signature = request.headers.get("x-roamly-affiliate-signature") || request.headers.get("x-affiliate-signature");

  if (!verifyAffiliateWebhookSignature({ rawBody, signature, secret })) {
    return NextResponse.json({ ok: false, error: "Invalid affiliate webhook signature." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = record(JSON.parse(rawBody || "{}"));
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid affiliate webhook payload." }, { status: 400 });
  }
  const result = await recordAffiliateConversion({
    supabase: admin,
    input: normalizeAffiliateConversionEvent(parsed)
  });

  if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({
    ok: true,
    conversion: result.conversion,
    booking: result.booking,
    needsConfirmation: result.needsConfirmation,
    message: result.message || null
  });
}
