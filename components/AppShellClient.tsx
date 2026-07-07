"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { I18nProvider, useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { TranslatedTextBoundary } from "@/components/i18n/TranslatedTextBoundary";
import { RoamlyLocationTracker } from "@/components/roamly/RoamlyLocationTracker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type AppShellAuthState = {
  authenticated: boolean;
  email?: string | null;
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AppShellContent({
  children,
  initialAuth
}: {
  children: React.ReactNode;
  initialAuth: AppShellAuthState;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [authenticated, setAuthenticated] = useState(initialAuth.authenticated);
  const [activeTripId, setActiveTripId] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setAuthenticated(initialAuth.authenticated);
  }, [initialAuth.authenticated]);

  useEffect(() => {
    try {
      const supabase = createSupabaseBrowserClient();
      let alive = true;

      void supabase.auth.getUser().then(({ data }) => {
        if (alive) setAuthenticated(Boolean(data.user));
      });

      const {
        data: { subscription }
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setAuthenticated(Boolean(session?.user));
      });

      return () => {
        alive = false;
        subscription.unsubscribe();
      };
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadMobileState() {
      if (!authenticated) {
        setActiveTripId("");
        setUnreadCount(0);
        return;
      }

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
  }, [authenticated, pathname]);

  const desktopRoutes = useMemo(
    () =>
      authenticated
        ? [
            { href: "/", label: t("ui.nav.home", "Home") },
            { href: "/plan", label: t("ui.nav.plan", "Plan") },
            { href: "/dashboard", label: t("ui.nav.trips", "Trips") },
            { href: "/notifications", label: t("ui.nav.notifications", "Notifications") },
            { href: "/account", label: t("ui.nav.account", "Account") }
          ]
        : [
            { href: "/", label: t("ui.nav.home", "Home") },
            { href: "/plan", label: t("ui.nav.plan", "Plan") },
            { href: "/pricing", label: t("ui.nav.pricing", "Pricing") }
          ],
    [authenticated, t]
  );

  const mobileRoutes = useMemo(
    () =>
      authenticated
        ? [
            { href: "/dashboard", label: t("ui.nav.dashboard", "Dashboard") },
            { href: activeTripId ? `/trip/${activeTripId}` : "/dashboard", label: t("ui.nav.trips", "Trips") },
            { href: "/notifications", label: t("ui.nav.notifications", "Notifications"), count: unreadCount },
            { href: "/account", label: t("ui.nav.account", "Account") },
            { href: "/auth/logout", label: t("ui.nav.logout", "Logout") }
          ]
        : [
            { href: "/login", label: t("ui.nav.login", "Log in") },
            { href: "/signup?next=/plan", label: t("ui.nav.signup", "Sign up") },
            { href: "/login?next=/plan", label: t("ui.nav.planTrip", "Plan trip") }
          ],
    [activeTripId, authenticated, t, unreadCount]
  );

  const planTripHref = authenticated ? "/plan" : "/login?next=/plan";

  return (
    <TranslatedTextBoundary>
      <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(84,214,198,0.24),transparent_34rem),linear-gradient(135deg,#F7FCFF_0%,#FFFFFF_46%,#FFF6E7_100%)] text-ink">
        <header className="sticky top-0 z-30 border-b border-white/50 bg-white/80 px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2" aria-label="Roamly home">
              <Image
                src="/roamly-wordmark@2x.png"
                alt="Roamly"
                width={150}
                height={62}
                priority
                className="h-10 w-auto object-contain sm:h-12"
              />
            </Link>

            <nav className="hidden items-center gap-2 md:flex">
              {desktopRoutes.map((route) => (
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
            </nav>

            <div className="flex items-center gap-2">
              <div className="hidden sm:block">
                <LanguageSwitcher />
              </div>
              {!authenticated ? (
                <>
                  <Link
                    href="/login"
                    className="hidden rounded-full border border-cloud bg-white px-4 py-2 text-sm font-black text-ink shadow-soft transition hover:-translate-y-0.5 hover:border-ocean sm:inline-flex"
                  >
                    {t("ui.nav.login", "Log in")}
                  </Link>
                  <Link
                    href="/signup?next=/plan"
                    className="hidden rounded-full border border-cloud bg-white px-4 py-2 text-sm font-black text-ink shadow-soft transition hover:-translate-y-0.5 hover:border-ocean lg:inline-flex"
                  >
                    {t("ui.nav.signup", "Sign up")}
                  </Link>
                </>
              ) : (
                <Link
                  href="/auth/logout"
                  className="hidden rounded-full border border-cloud bg-white px-4 py-2 text-sm font-black text-ink shadow-soft transition hover:-translate-y-0.5 hover:border-coral sm:inline-flex"
                >
                  {t("ui.nav.logout", "Logout")}
                </Link>
              )}
              <Link href={planTripHref} className="rounded-full bg-ink px-4 py-2 text-sm font-black text-white shadow-soft transition hover:bg-ocean">
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

        <nav
          className={`fixed inset-x-2 bottom-3 z-40 grid gap-1 rounded-[1.4rem] border border-white/70 bg-white/95 p-2 shadow-soft backdrop-blur-xl md:hidden ${
            authenticated ? "grid-cols-5" : "grid-cols-3"
          }`}
        >
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

export function AppShellClient({
  children,
  initialAuth
}: {
  children: React.ReactNode;
  initialAuth: AppShellAuthState;
}) {
  return (
    <I18nProvider>
      <AppShellContent initialAuth={initialAuth}>{children}</AppShellContent>
    </I18nProvider>
  );
}
