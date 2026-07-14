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

function trackedAffiliateHref(params: {
  href: string;
  tripId: string;
  category: string;
  title: string;
  provider: string;
  hasAffiliateUrl: boolean;
  urlType: BookingUrlType;
}) {
  if (!params.hasAffiliateUrl || params.urlType !== "affiliate" || !/^https?:\/\//i.test(params.href)) return params.href;
  const query = new URLSearchParams({
    tripId: params.tripId,
    recommendationId: `${params.category}:${params.title}`.slice(0, 180),
    provider: params.provider,
    affiliatePartner: params.provider,
    category: params.category,
    urlType: params.urlType,
    destinationUrl: params.href,
    affiliateUrl: params.href
  });
  return `/api/roamly/affiliate/click?${query.toString()}`;
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
      className="roamly-no-print inline-flex w-fit shrink-0 rounded-full border border-ocean/20 bg-ocean/10 px-4 py-2 text-sm font-black text-ocean transition hover:border-ocean/40 hover:bg-ocean/20"
    >
      {label}
    </a>
  );
}
