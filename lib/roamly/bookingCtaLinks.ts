import type { BookingUrlType } from "@/lib/roamly/bookingLinks";

export type BookingCtaHrefParams = {
  href: string;
  tripId: string;
  category: string;
  title: string;
  provider: string;
  hasAffiliateUrl: boolean;
  urlType: BookingUrlType;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

export function isTravelerSafeStay22BookingUrl(value: string) {
  const raw = clean(value);
  if (!raw) return false;

  try {
    const url = new URL(raw, "https://roamly.local");
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    if (host !== "stay22.com" && !host.endsWith(".stay22.com")) {
      return true;
    }

    const pathname = url.pathname.toLowerCase();
    if (host === "app.stay22.com") return false;
    if (/\b(app|admin|partner|partners|dashboard|login|signin|sign-in|account)\b/.test(host)) return false;
    if (/\/(?:app|admin|partner|partners|dashboard|login|signin|sign-in|account)(?:\/|$)/i.test(url.pathname)) return false;
    if (/\b(?:dashboard|login|signin|sign-in|account|admin|partner|partners)\b/.test(pathname)) return false;

    return true;
  } catch {
    return false;
  }
}

export function trackedAffiliateHref(params: BookingCtaHrefParams) {
  if (!isTravelerSafeStay22BookingUrl(params.href)) {
    return "";
  }

  if (!params.hasAffiliateUrl && params.urlType !== "affiliate") {
    return params.href;
  }

  const searchParams = new URLSearchParams({
    tripId: params.tripId,
    category: params.category,
    title: params.title,
    provider: params.provider,
    destinationUrl: params.href,
    affiliateUrl: params.href
  });

  return `/api/roamly/affiliate/click?${searchParams.toString()}`;
}
