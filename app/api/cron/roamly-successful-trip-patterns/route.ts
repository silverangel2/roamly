import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runSuccessfulTripExperiencePatternAggregation } from "@/lib/roamly/successfulTripExperiencePatternAggregation";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return NextResponse.json({ ok: false, error: "Cron secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, secret)) return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });

  const result = await runSuccessfulTripExperiencePatternAggregation(admin);
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
