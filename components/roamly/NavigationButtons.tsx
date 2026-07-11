"use client";

import { buildNavigationLinks, type NavigationDestination } from "@/lib/roamly/navigationLinks";

type NavigationButtonsProps = NavigationDestination & {
  tripId?: string;
  className?: string;
  showHeading?: boolean;
};

export function NavigationButtons({ tripId, className = "", showHeading = false, ...destination }: NavigationButtonsProps) {
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
    <div className={className}>
      {showHeading ? <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Navigate</p> : null}
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.provider}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            onClick={() => void record(link.provider)}
            className="rounded-full bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
