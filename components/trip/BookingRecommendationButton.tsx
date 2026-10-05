"use client";

import type { BookingUrlType } from "@/lib/roamly/bookingLinks";
import { trackedAffiliateHref } from "@/lib/roamly/bookingCtaLinks";

type BookingRecommendationButtonProps = {
  href: string;
  label: string;
  tripId: string;
  category: string;
  title: string;
  provider: string;
  recommendationId?: string | null;
  hasAffiliateUrl: boolean;
  urlType: BookingUrlType;
  /** Keep the control full width at every breakpoint. */
  fill?: boolean;
  /** Primary is the one filled action. Secondary stays visible, just quieter. */
  emphasis?: "primary" | "secondary";
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
  recommendationId,
  hasAffiliateUrl,
  urlType,
  fill = false,
  emphasis = "primary"
}: BookingRecommendationButtonProps) {
  if (!href) return null;

  const isExternal = /^https?:\/\//i.test(href);
  const trackedHref = trackedAffiliateHref({ href, tripId, category, title, provider, recommendationId, hasAffiliateUrl, urlType });

  if (!trackedHref) return null;

  const tone = emphasis === "secondary"
    ? "border border-[#e6dece] bg-white text-ink hover:bg-[#fbf8ef]"
    : "border border-transparent bg-ocean text-white hover:bg-[#17899a]";

  return (
    <a
      href={trackedHref}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer sponsored" : undefined}
      aria-label={
        category === "hotel"
          ? `${label} — opens booking provider`
          : label
      }
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
      className={`roamly-press roamly-no-print inline-flex min-h-11 w-full items-center justify-center rounded-2xl px-5 py-2.5 text-sm font-semibold tracking-tight transition ${tone} ${fill ? "" : "sm:w-auto"}`}
    >
      {label}
    </a>
  );
}
