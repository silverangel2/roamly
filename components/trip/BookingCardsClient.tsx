"use client";

import { useEffect } from "react";

export type BookingCardLink = {
  title: string;
  label: string;
  description: string;
  href: string;
  booking_category: string;
  affiliate_enabled: boolean;
  affiliate_provider: string;
  affiliate_disclosure?: string;
};

function getVisitorKey() {
  const key = "roamly_visitor_key";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function trackBookingEvent(eventType: string, metadata: Record<string, unknown>) {
  void fetch("/api/roamly/events/app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      visitorKey: getVisitorKey(),
      eventType,
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

export function BookingCardsClient({
  tripId,
  destination,
  links,
  showDisclosure
}: {
  tripId: string;
  destination: string;
  links: BookingCardLink[];
  showDisclosure: boolean;
}) {
  useEffect(() => {
    links.forEach((link) => {
      const metadata = {
        tripId,
        destination,
        bookingCategory: link.booking_category,
        affiliateProvider: link.affiliate_provider,
        affiliateEnabled: link.affiliate_enabled
      };
      trackBookingEvent("booking_link_viewed", metadata);
      if (!link.affiliate_enabled || link.affiliate_provider === "direct") {
        trackBookingEvent("affiliate_provider_missing", metadata);
      }
    });
  }, [destination, links, tripId]);

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((link) => (
        <a
          key={link.title}
          href={link.href}
          target={/^https?:\/\//i.test(link.href) ? "_blank" : undefined}
          rel={/^https?:\/\//i.test(link.href) ? "noopener noreferrer" : undefined}
          onClick={() =>
            trackBookingEvent("booking_link_clicked", {
              trip_id: tripId,
              category: link.booking_category,
              title: link.title,
              provider: link.affiliate_provider || "direct",
              has_affiliate_url: link.affiliate_enabled,
              url_type: link.affiliate_enabled ? "affiliate" : "normal_search",
              destination
            })
          }
          className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-ocean/40"
        >
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{link.label}</p>
          <h3 className="mt-2 text-lg font-black text-ink">{link.title}</h3>
          <p className="mt-2 text-sm font-bold leading-5 text-slate-500">{link.description}</p>
          <p className="mt-3 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
            {link.affiliate_enabled ? `${link.affiliate_provider} partner link` : "Roamly discovery link"}
          </p>
        </a>
      ))}
      {showDisclosure ? (
        <p className="rounded-2xl bg-mist px-4 py-3 text-xs font-bold leading-5 text-slate-500 sm:col-span-2 lg:col-span-3">
          {links[0]?.affiliate_disclosure}
        </p>
      ) : null}
    </section>
  );
}
