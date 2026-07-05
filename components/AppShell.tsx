"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { primaryRoutes } from "@/lib/app-routes";
import { I18nProvider, useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { TranslatedTextBoundary } from "@/components/i18n/TranslatedTextBoundary";
import { RoamlyLocationTracker } from "@/components/roamly/RoamlyLocationTracker";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
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
      { href: "/plan", label: t("ui.nav.plan", "Plan") },
      { href: "/dashboard", label: t("ui.nav.trips", "Trips") },
      { href: activeTripId ? `/trip/${activeTripId}/live` : "/notifications", label: t("ui.nav.live", "Live") },
      { href: "/notifications", label: t("ui.nav.alerts", "Alerts"), count: unreadCount },
      { href: "/account", label: t("ui.nav.account", "Account") }
    ],
    [activeTripId, t, unreadCount]
  );

  return (
    <TranslatedTextBoundary>
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
                  {route.href === "/" ? t("ui.nav.home", route.label) : route.href === "/plan" ? t("ui.nav.plan", route.label) : route.href === "/dashboard" ? t("ui.nav.trips", route.label) : t("ui.nav.account", route.label)}
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
                {t("ui.nav.pricing", "Pricing")}
              </Link>
            </nav>

            <div className="flex items-center gap-2">
              <div className="hidden sm:block">
                <LanguageSwitcher />
              </div>
              <Link href="/plan" className="rounded-full bg-ink px-4 py-2 text-sm font-black text-white shadow-soft transition hover:bg-ocean">
                {t("ui.nav.planTrip", "Plan trip")}
              </Link>
            </div>
          </div>
          <div className="mx-auto mt-3 max-w-6xl sm:hidden">
            <LanguageSwitcher />
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
    </TranslatedTextBoundary>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AppShellContent>{children}</AppShellContent>
    </I18nProvider>
  );
}
