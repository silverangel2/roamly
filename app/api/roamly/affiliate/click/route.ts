import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { createAffiliateClick } from "@/lib/roamly/affiliateTracking";

export const runtime = "nodejs";

function text(request: NextRequest, key: string) {
  return request.nextUrl.searchParams.get(key)?.trim() || "";
}

export async function GET(request: NextRequest) {
  const affiliateUrl = safeExternalUrl(text(request, "affiliateUrl"));
  const destinationUrl = safeExternalUrl(text(request, "destinationUrl")) || affiliateUrl;
  if (!affiliateUrl || !destinationUrl) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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
