"use client";

import type { BookingUrlType } from "@/lib/roamly/bookingLinks";

type BookingRecommendationButtonProps = {
  href: string;
  label: string;
  tripId: string;
  category: string;
  title: string;
  provider: string;
  hasAffiliateUrl: boolean;
  urlType: BookingUrlType;
};

function getVisitorKey() {
  const key = "roamly_visitor_key";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function trackBookingClick(metadata: Record<string, unknown>) {
  void fetch("/api/roamly/events/app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      visitorKey: getVisitorKey(),
      eventType: "booking_link_clicked",
      path: window.location.pathname,
      url: window.location.href,
      title: document.title,
      referrer: document.referrer,
      platform: navigator.platform,
      language: navigator.language,
      metadata
    })
  }).catch(() => undefined);
}

function isUnsafeStay22BookingUrl(value: string) {
  const url = value.toLowerCase();

  return (
    url.includes("hub.stay22.com") ||
    url.includes("app.stay22.com") ||
    url.includes("dashboard") ||
    url.includes("signin") ||
    url.includes("sign-in") ||
    url.includes("login") ||
    url.includes("account") ||
    url.includes("partner")
  );
}

function bookingDotComSearchUrl(params: {
  title: string;
  category: string;
  provider: string;
}) {
  const query = [
    params.title,
    params.category === "hotel" ? "hotel" : "",
    params.provider && !params.provider.toLowerCase().includes("stay22")
      ? params.provider
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  const searchParams = new URLSearchParams({
    ss: query || "hotel",
    group_adults: "1",
    no_rooms: "1",
    group_children: "0",
    selected_currency: "CAD"
  });

  return `https://www.booking.com/searchresults.html?${searchParams.toString()}`;
}

function trackedAffiliateHref(params: {
  href: string;
  tripId: string;
  category: string;
  title: string;
  provider: string;
  hasAffiliateUrl: boolean;
  urlType: BookingUrlType;
}) {
  if (isUnsafeStay22BookingUrl(params.href)) {
    return bookingDotComSearchUrl({
      title: params.title,
      category: params.category,
      provider: params.provider
    });
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

export function BookingRecommendationButton({
  href,
  label,
  tripId,
  category,
  title,
  provider,
  hasAffiliateUrl,
  urlType
}: BookingRecommendationButtonProps) {
  if (!href) return null;

  const isExternal = /^https?:\/\//i.test(href);
  const trackedHref = trackedAffiliateHref({ href, tripId, category, title, provider, hasAffiliateUrl, urlType });

  return (
    <a
      href={trackedHref}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer sponsored" : undefined}
      onClick={() =>
        trackBookingClick({
          trip_id: tripId,
          category,
          title,
          provider,
          has_affiliate_url: hasAffiliateUrl,
          url_type: urlType
        })
      }
      className="roamly-no-print inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-ocean/20 bg-ocean px-5 py-2.5 text-sm font-black text-white transition hover:bg-ocean/90 sm:w-auto"
    >
      {label}
    </a>
  );
}
