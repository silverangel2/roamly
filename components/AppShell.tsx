"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { primaryRoutes } from "@/lib/app-routes";
import { RoamlyLocationTracker } from "@/components/roamly/RoamlyLocationTracker";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [activeTripId, setActiveTripId] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let alive = true;

    async function loadMobileState() {
      const [activeResponse, notificationsResponse] = await Promise.all([
        fetch("/api/roamly/trips/active").catch(() => null),
        fetch("/api/roamly/notifications").catch(() => null)
      ]);

      if (!alive) return;

      if (activeResponse?.ok) {
        const data = await activeResponse.json().catch(() => null);
        setActiveTripId(data?.activeTrip?.id || "");
      }

      if (notificationsResponse?.ok) {
        const data = await notificationsResponse.json().catch(() => null);
        const unread = Array.isArray(data?.notifications)
          ? data.notifications.filter((item: { status?: string }) => item.status !== "read").length
          : 0;
        setUnreadCount(unread);
      }
    }

    void loadMobileState();
    return () => {
      alive = false;
    };
  }, [pathname]);

  const mobileRoutes = useMemo(
    () => [
      { href: "/plan", label: "Plan" },
      { href: "/dashboard", label: "Trips" },
      { href: activeTripId ? `/trip/${activeTripId}/live` : "/notifications", label: "Live" },
      { href: "/notifications", label: "Alerts", count: unreadCount },
      { href: "/account", label: "Account" }
    ],
    [activeTripId, unreadCount]
  );

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(84,214,198,0.24),transparent_34rem),linear-gradient(135deg,#F7FCFF_0%,#FFFFFF_46%,#FFF6E7_100%)] text-ink">
      <header className="sticky top-0 z-30 border-b border-white/50 bg-white/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2" aria-label="Roamly home">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-ocean to-lagoon text-sm font-black text-white shadow-glow">
              R
            </span>
            <span className="text-xl font-black tracking-tight">Roamly</span>
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            {primaryRoutes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={`rounded-full px-4 py-2 text-sm font-black transition ${
                  isActive(pathname, route.href)
                    ? "bg-ink text-white"
                    : "text-slate-600 hover:bg-white hover:text-ink"
                }`}
              >
                {route.label}
              </Link>
            ))}
            <Link
              href="/pricing"
              className={`rounded-full px-4 py-2 text-sm font-black transition ${
                isActive(pathname, "/pricing")
                  ? "bg-ink text-white"
                  : "text-slate-600 hover:bg-white hover:text-ink"
              }`}
            >
              Pricing
            </Link>
          </nav>

          <Link href="/plan" className="rounded-full bg-ink px-4 py-2 text-sm font-black text-white shadow-soft transition hover:bg-ocean">
            Plan trip
          </Link>
        </div>
      </header>

      {children}

      <RoamlyLocationTracker />

      <nav className="fixed inset-x-2 bottom-3 z-40 grid grid-cols-5 gap-1 rounded-[1.4rem] border border-white/70 bg-white/92 p-2 shadow-soft backdrop-blur-xl md:hidden">
        {mobileRoutes.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            className={`relative rounded-2xl px-1 py-3 text-center text-[0.68rem] font-black transition ${
              isActive(pathname, route.href)
                ? "bg-ink text-white"
                : "text-slate-500 hover:bg-mist hover:text-ink"
            }`}
          >
            {route.label}
            {"count" in route && route.count ? (
              <span className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[0.62rem] font-black text-white">
                {route.count > 9 ? "9+" : route.count}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
