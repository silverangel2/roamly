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
  if (!href) {
    return (
      <span className="roamly-no-print inline-flex w-fit shrink-0 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-400">
        Search link unavailable
      </span>
    );
  }

  const isExternal = /^https?:\/\//i.test(href);

  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
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
