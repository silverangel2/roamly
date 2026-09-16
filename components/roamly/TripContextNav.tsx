"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type TripContextNavProps = {
  tripId: string;
  title: string;
  destination: string;
  dates: string;
  status?: string;
  showContext?: boolean;
};

const destinations = [
  { key: "home", label: "Home", suffix: "" },
  { key: "itinerary", label: "Plan", suffix: "#day-by-day" },
  { key: "briefing", label: "Briefing", suffix: "#overview" },
  { key: "explore", label: "Explore", suffix: "/explore" },
  { key: "budget", label: "Budget", suffix: "#budget" },
  { key: "bookings", label: "Bookings", suffix: "/bookings" },
  { key: "today", label: "Live", suffix: "/live" }
] as const;

function isSelected(pathname: string, hash: string, tripId: string, key: (typeof destinations)[number]["key"]) {
  const base = `/trip/${tripId}`;
  if (key === "home") return (pathname === base || pathname === `${base}/`) && ["", "#"].includes(hash);
  if (key === "itinerary") return (pathname === base || pathname === `${base}/`) && hash === "#day-by-day";
  if (key === "briefing") return (pathname === base || pathname === `${base}/`) && ["#overview", "#essentials", "#travel-notes"].includes(hash);
  if (key === "budget") return (pathname === base || pathname === `${base}/`) && hash === "#budget";
  return pathname === `${base}${destinations.find((item) => item.key === key)?.suffix}`;
}

export function TripContextNav({ tripId, title, destination, dates, status, showContext = true }: TripContextNavProps) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  return (
    <section className="roamly-no-print mb-5 border-b border-[#e7dfd2] bg-transparent px-0 py-3 sm:px-1">
      {showContext ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">{title}</p>
            <p className="truncate text-xs font-medium text-slate-500">{destination} · {dates}</p>
          </div>
          {status ? <span className="hidden shrink-0 rounded-full bg-mist px-3 py-1 text-xs font-black text-slate-600 sm:inline-flex">{status}</span> : null}
        </div>
      ) : null}
      <nav aria-label="Trip navigation" className={`${showContext ? "mt-3 " : ""}min-w-0 overflow-x-auto pb-1`}>
        <div className="flex min-w-max gap-1 sm:gap-2">
        {destinations.map((destinationItem) => {
          const selected = isSelected(pathname, hash, tripId, destinationItem.key);
          const href = `/trip/${tripId}${destinationItem.suffix}`;
          return (
            <Link
              key={destinationItem.key}
              href={href}
              aria-current={selected ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 py-2 text-center text-xs font-black transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/30 sm:min-w-24 sm:px-4 sm:text-sm ${
                selected
                  ? "bg-ocean text-white shadow-sm"
                  : "text-slate-600 hover:bg-mist hover:text-ink"
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
