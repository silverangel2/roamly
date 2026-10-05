"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type TripContextNavProps = {
  tripId: string;
  title: string;
  destination: string;
  dates: string;
  status?: string;
  showContext?: boolean;
  /** When false, the trip has no itinerary content — hash links to tab panels
   *  would be dead, so they are hidden. */
  contentReady?: boolean;
  /** Server-known section, such as ?focus=budget, so the tab and scroll stay in sync. */
  focusAnchor?: string | null;
};

const destinations = [
  { key: "home", label: "Home", suffix: "" },
  { key: "customize", label: "Customize", suffix: "#customize" },
  { key: "itinerary", label: "Itinerary", suffix: "#day-by-day" },
  { key: "briefing", label: "Briefing", suffix: "#overview" },
  { key: "explore", label: "Explore", suffix: "/explore" },
  { key: "budget", label: "Budget", suffix: "#budget" },
  { key: "bookings", label: "Bookings", suffix: "/bookings" },
  { key: "today", label: "Live", suffix: "/live" }
] as const;

function isSelected(pathname: string, hash: string, tripId: string, key: (typeof destinations)[number]["key"]) {
  const base = `/trip/${tripId}`;
  if (key === "home") return (pathname === base || pathname === `${base}/`) && ["", "#"].includes(hash);
  if (key === "customize") return (pathname === base || pathname === `${base}/`) && hash === "#customize";
  if (key === "itinerary") return (pathname === base || pathname === `${base}/`) && hash === "#day-by-day";
  if (key === "briefing") return (pathname === base || pathname === `${base}/`) && ["#overview", "#requirements", "#essentials", "#travel-notes"].includes(hash);
  if (key === "budget") return (pathname === base || pathname === `${base}/`) && hash === "#budget";
  return pathname === `${base}${destinations.find((item) => item.key === key)?.suffix}`;
}

const hashToTabId: Record<string, string> = {
  "#day-by-day": "roamly-tab-day-by-day",
  "#overview": "roamly-tab-overview",
  "#budget": "roamly-tab-budget",
  "#requirements": "roamly-tab-requirements",
  "#essentials": "roamly-tab-essentials",
  "#travel-notes": "roamly-tab-travel-notes",
  "#bookings": "roamly-tab-bookings"
};

/** The trip page shows tab panels through radio inputs; a hash link alone cannot
 *  reveal a hidden panel, so activate the matching tab before the browser jumps. */
function activateTabForSuffix(suffix: string) {
  if (suffix === "#customize") {
    clearTripPanels();
    return;
  }
  const tabId = hashToTabId[suffix];
  if (!tabId || typeof document === "undefined") return;
  const input = document.getElementById(tabId) as HTMLInputElement | null;
  if (input && !input.checked) input.click();
}

/** "Home" should reset the view: clear any hash, reveal the default tab panel,
 *  and glide back to the top. A plain link to the same path is a no-op when a
 *  hash is present, which made Home feel dead. */
function clearTripPanels() {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLInputElement>('input[name="roamly-completed-tab"]').forEach((input) => {
    input.checked = false;
  });
}

function scrollToHash(hash: string) {
  const id = hash.replace(/^#/, "");
  if (!id || typeof document === "undefined") return;
  const node = document.getElementById(id);
  if (!node) return;
  window.requestAnimationFrame(() => {
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function goHome(tripId: string, setHash: (hash: string) => void) {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", `/trip/${tripId}`);
  setHash("");
  clearTripPanels();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function TripContextNav({ tripId, title, destination, dates, status, showContext = true, contentReady = true, focusAnchor = null }: TripContextNavProps) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateHash = () => {
      const fromWindow = window.location.hash;
      const nextHash = fromWindow && fromWindow !== "#" ? fromWindow : focusAnchor ? `#${focusAnchor}` : "";
      setHash(nextHash);
      if (!nextHash) clearTripPanels();
      else {
        activateTabForSuffix(nextHash);
        scrollToHash(nextHash);
      }
    };
    updateHash();
    window.addEventListener("hashchange", updateHash);
    window.addEventListener("popstate", updateHash);
    return () => {
      window.removeEventListener("hashchange", updateHash);
      window.removeEventListener("popstate", updateHash);
    };
  }, [pathname, focusAnchor]);

  useEffect(() => {
    const row = rowRef.current;
    const selected = row?.querySelector<HTMLElement>("[aria-current='page']");
    if (!row || !selected) return;
    const left = selected.offsetLeft - 12;
    if (row.scrollWidth > row.clientWidth) row.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [hash, pathname]);

  const visibleDestinations = contentReady
    ? destinations
    : destinations.filter((item) => !item.suffix.startsWith("#"));

  return (
    <section className="roamly-no-print mb-4 border-b border-[#e7dfd2]/80 bg-transparent px-0 pb-3 pt-1 sm:px-1">
      {showContext ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">{title}</p>
            <p className="truncate text-xs font-medium text-slate-500">{destination} · {dates}</p>
          </div>
          {status ? <span className="hidden shrink-0 rounded-full bg-mist px-3 py-1 text-xs font-bold text-slate-600 sm:inline-flex">{status}</span> : null}
        </div>
      ) : null}
      <nav aria-label="Trip navigation" className={`${showContext ? "mt-3 " : ""}roamly-trip-tabs min-w-0`}>
        <div ref={rowRef} className="flex flex-wrap gap-1.5 sm:flex-nowrap sm:snap-x sm:snap-mandatory sm:gap-1 sm:overflow-x-auto sm:overscroll-x-contain sm:pb-1">
        {visibleDestinations.map((destinationItem) => {
          const selected = isSelected(pathname, hash, tripId, destinationItem.key);
          const href = `/trip/${tripId}${destinationItem.suffix}`;
          const isHome = destinationItem.key === "home";
          return (
            <Link
              key={destinationItem.key}
              href={href}
              onClick={(event) => {
                if (isHome) {
                  event.preventDefault();
                  goHome(tripId, setHash);
                  return;
                }
                if (destinationItem.suffix.startsWith("#")) {
                  event.preventDefault();
                  const nextHash = destinationItem.suffix;
                  window.history.pushState(null, "", `/trip/${tripId}${nextHash}`);
                  setHash(nextHash);
                  activateTabForSuffix(nextHash);
                  scrollToHash(nextHash);
                }
              }}
              aria-current={selected ? "page" : undefined}
              className={`roamly-press inline-flex min-h-11 flex-[1_1_30%] snap-start items-center justify-center rounded-full px-3 py-2 text-center text-[0.8125rem] font-medium tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/20 sm:min-w-[5.6rem] sm:flex-none sm:px-3.5 sm:text-sm ${
                selected
                  ? "bg-ink text-white"
                  : "bg-white/70 text-slate-600 hover:bg-white hover:text-ink"
              }`}
            >
              {destinationItem.label}
            </Link>
          );
        })}
        </div>
      </nav>
    </section>
  );
}
