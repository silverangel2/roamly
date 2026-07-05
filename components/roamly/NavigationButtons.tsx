"use client";

import { buildNavigationLinks, type NavigationDestination } from "@/lib/roamly/navigationLinks";

type NavigationButtonsProps = NavigationDestination & {
  tripId?: string;
  className?: string;
};

export function NavigationButtons({ tripId, className = "", ...destination }: NavigationButtonsProps) {
  const links = buildNavigationLinks(destination);
  if (!links.length) return null;

  async function record(provider: string) {
    if (!tripId) return;
    await fetch("/api/roamly/navigation/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId,
        provider,
        destinationTitle: destination.destinationLabel || "Destination",
        destinationAddress: destination.address || ""
      })
    }).catch(() => undefined);
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {links.map((link) => (
        <a
          key={link.provider}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          onClick={() => void record(link.provider)}
          className="rounded-full bg-mist px-3 py-2 text-xs font-black text-ink ring-1 ring-cloud transition hover:bg-ocean hover:text-white"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
