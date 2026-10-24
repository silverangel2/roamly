import { NextResponse } from "next/server";
import { getHouseAdCreative } from "@/lib/houseAds";
import { resolveHouseAdClickLanding } from "@/lib/houseAdServer";
import { recordHouseAdEvent } from "@/lib/houseAdEvents";

/**
 * House Ads — click-through. Records the click server-side (bots ignored,
 * mirroring the event route), then 302-redirects to the creative's landing.
 * The landing is resolved here, never trusted from the client, so affiliate
 * tagging always comes from the site's own builders.
 */
const BOT_UA = /bot|crawler|spider|slurp|headless|preview|facebookexternalhit|curl|wget|python-requests|lighthouse/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ creativeId: string }> },
) {
  const { creativeId } = await params;
  const creative = getHouseAdCreative(creativeId);
  const landing = resolveHouseAdClickLanding(creativeId);
  if (!creative || !landing) {
    return NextResponse.json({ error: "Unknown house ad creative." }, { status: 404 });
  }

  const ua = request.headers.get("user-agent") || "";
  if (ua && !BOT_UA.test(ua)) {
    let pagePath: string | null = null;
    try {
      const referer = request.headers.get("referer");
      if (referer) pagePath = new URL(referer).pathname.slice(0, 300);
    } catch {
      pagePath = null;
    }
    await recordHouseAdEvent({ creativeId: creative.id, eventType: "click", pagePath });
  }

  const response = NextResponse.redirect(landing, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
