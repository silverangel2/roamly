import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { safeAffiliateRedirectUrl } from "@/lib/roamly/affiliateRedirect";
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

  const tripId = text(request, "tripId");
  const result = await createAffiliateClick({
    supabase: auth.supabase,
    input: {
      userId: auth.user.id,
      tripId,
      recommendationId: text(request, "recommendationId"),
      provider: text(request, "provider"),
      affiliatePartner: text(request, "affiliatePartner"),
      destinationUrl,
      affiliateUrl,
      deviceContext: {
        userAgent: request.headers.get("user-agent") || null,
        referrer: request.headers.get("referer") || null,
        urlType: text(request, "urlType"),
        category: text(request, "category")
      }
    }
  });

  return NextResponse.redirect(result.redirectUrl || affiliateUrl);
}
