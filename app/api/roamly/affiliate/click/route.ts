import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { safeAffiliateRedirectUrl } from "@/lib/roamly/affiliateRedirect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createAffiliateClick } from "@/lib/roamly/affiliateTracking";

export const runtime = "nodejs";

function text(request: NextRequest, key: string) {
  return request.nextUrl.searchParams.get(key)?.trim() || "";
}

export async function GET(request: NextRequest) {
  const affiliateUrl = safeAffiliateRedirectUrl(text(request, "affiliateUrl"));
  const rawDestinationUrl = text(request, "destinationUrl");
  const destinationUrl = rawDestinationUrl ? safeAffiliateRedirectUrl(rawDestinationUrl) : affiliateUrl;
  if (!affiliateUrl || !destinationUrl) {
    return NextResponse.json({ ok: false, error: "INVALID_AFFILIATE_URL" }, { status: 400 });
  }

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const writer = createSupabaseAdminClient();
  if (!writer) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_NOT_CONFIGURED" }, { status: 503 });
  }

  const tripId = text(request, "tripId");
  const result = await createAffiliateClick({
    supabase: auth.supabase,
    writer,
    input: {
      userId: auth.user.id,
      tripId,
      recommendationId: text(request, "recommendationId"),
      bookingType: text(request, "category"),
      provider: text(request, "provider"),
      affiliatePartner: text(request, "affiliatePartner"),
      destinationUrl,
      affiliateUrl,
      deviceContext: {
        userAgent: request.headers.get("user-agent") || null,
        referrer: request.headers.get("referer") || null,
        urlType: text(request, "urlType"),
        category: text(request, "category"),
        recommendation_title: text(request, "title")
      }
    }
  });

  if (result.error || !result.click) {
    return NextResponse.json(
      { ok: false, error: result.error || "AFFILIATE_REFERRAL_NOT_CREATED" },
      { status: result.error === "TRIP_NOT_FOUND" ? 404 : 503 }
    );
  }

  return NextResponse.redirect(result.redirectUrl || affiliateUrl);
}
