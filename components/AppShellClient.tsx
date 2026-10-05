"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { I18nProvider, useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { TranslatedTextBoundary } from "@/components/i18n/TranslatedTextBoundary";
import { RoamlyLocationTracker } from "@/components/roamly/RoamlyLocationTracker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { countUnreadNotifications, shouldLoadShellState } from "@/lib/roamly/appShellState";
import { clearPlannerDraftOnLogout } from "@/lib/roamly/planDraftStorage";
import { nextBottomNavHidden } from "@/lib/roamly/bottomNavScroll";
import { primaryNavActiveHref } from "@/lib/roamly/shellNav";

export type AppShellAuthState = {
  authenticated: boolean;
  email?: string | null;
};

function isActive(pathname: string, href: string, hrefs: readonly string[]) {
  return primaryNavActiveHref(pathname, hrefs) === href;
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
  const [bottomNavHidden, setBottomNavHidden] = useState(false);
  const bottomNavRef = useRef<HTMLElement>(null);
  const bottomNavHiddenRef = useRef(false);
  const bottomNavAnchorRef = useRef(0);

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
      } = supabase.auth.onAuthStateChange((event, session) => {
        setAuthenticated(Boolean(session?.user));
        if (event === "SIGNED_OUT") clearPlannerDraftOnLogout(window.localStorage, window.sessionStorage);
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
        setUnreadCount(Array.isArray(data?.notifications) ? countUnreadNotifications(data.notifications) : 0);
      }
    }

    const handleNotificationShellState = (event: Event) => {
      if (pathname !== "/notifications") return;
      const detail = (event as CustomEvent<{ activeTripId?: unknown; unreadCount?: unknown }>).detail;
      setActiveTripId(typeof detail?.activeTripId === "string" ? detail.activeTripId : "");
      setUnreadCount(typeof detail?.unreadCount === "number" && Number.isFinite(detail.unreadCount) ? detail.unreadCount : 0);
    };

    const handleShellStateRefresh = () => {
      void loadMobileState();
    };

    window.addEventListener("roamly:notifications-shell-state", handleNotificationShellState);
    window.addEventListener("roamly:shell-state-refresh", handleShellStateRefresh);
    if (shouldLoadShellState(authenticated, pathname)) void loadMobileState();

    return () => {
      alive = false;
      window.removeEventListener("roamly:notifications-shell-state", handleNotificationShellState);
      window.removeEventListener("roamly:shell-state-refresh", handleShellStateRefresh);
    };
  }, [authenticated, pathname]);

  useEffect(() => {
    bottomNavAnchorRef.current = window.scrollY;
    bottomNavHiddenRef.current = false;
    setBottomNavHidden(false);
  }, [pathname]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const nav = bottomNavRef.current;
        const focused = Boolean(nav && document.activeElement instanceof Node && nav.contains(document.activeElement));
        const next = nextBottomNavHidden({
          anchorY: bottomNavAnchorRef.current,
          currentY: window.scrollY,
          hidden: bottomNavHiddenRef.current,
          focused
        });
        bottomNavAnchorRef.current = next.anchorY;
        if (next.hidden === bottomNavHiddenRef.current) return;
        bottomNavHiddenRef.current = next.hidden;
        setBottomNavHidden(next.hidden);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const desktopRoutes = useMemo(
    () =>
        authenticated
        ? [
            { href: "/dashboard", label: t("ui.nav.trips", "Trips") },
            { href: "/plan", label: t("ui.nav.planTrip", "Plan trip") },
            { href: "/finds", label: t("ui.nav.finds", "Finds") },
            { href: "/notifications", label: t("ui.nav.alerts", "Alerts") },
            { href: "/account", label: t("ui.nav.account", "Account") }
          ]
        : [
            { href: "/", label: t("ui.nav.home", "Home") },
            { href: "/#the-journey", label: t("ui.nav.howItWorks", "How it works") },
            { href: "/plan", label: t("ui.nav.plan", "Plan") },
            { href: "/finds", label: t("ui.nav.finds", "Finds") },
            { href: "/pricing", label: t("ui.nav.pricing", "Pricing") }
          ],
    [authenticated, t]
  );

  const mobileRoutes = useMemo(
    () =>
        authenticated
        ? [
            { href: activeTripId ? `/trip/${activeTripId}` : "/dashboard", label: t("ui.nav.trip", "Trip") },
            { href: "/plan", label: t("ui.nav.planTrip", "Plan") },
            { href: "/finds", label: t("ui.nav.finds", "Finds") },
            { href: "/notifications", label: t("ui.nav.alerts", "Alerts"), count: unreadCount },
            { href: "/account", label: t("ui.nav.account", "Account") }
          ]
        : [
            { href: "/", label: t("ui.nav.home", "Home") },
            { href: "/#the-journey", label: t("ui.nav.howItWorks", "How it works") },
            { href: "/plan", label: t("ui.nav.plan", "Plan") },
            { href: "/finds", label: t("ui.nav.finds", "Finds") },
            { href: "/login", label: t("ui.nav.login", "Log in") }
          ],
    [activeTripId, authenticated, t, unreadCount]
  );

  const planTripHref = "/plan";
  const planTripLabel = authenticated ? t("ui.nav.planTrip", "Plan trip") : t("ui.nav.startPlanning", "Start planning");

  return (
    <TranslatedTextBoundary>
      <div data-bottom-nav={bottomNavHidden ? "hidden" : "visible"} className={`roamly-app-shell min-h-dvh min-w-0 bg-[#fbf8ef] text-ink ${authenticated ? "roamly-authenticated" : ""}`}>
        <header className="sticky top-0 z-30 border-b border-cloud/80 bg-white/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[0_8px_30px_rgba(16,32,51,0.04)] backdrop-blur-2xl">
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

            <nav aria-label="Primary navigation" className="hidden items-center gap-1 lg:flex">
              {desktopRoutes.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    isActive(pathname, route.href, desktopRoutes.map((item) => item.href))
                      ? "bg-ink text-white"
                      : "text-slate-600 hover:bg-mist hover:text-ink"
                  }`}
                  aria-current={isActive(pathname, route.href, desktopRoutes.map((item) => item.href)) ? "page" : undefined}
                >
                  {route.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <div className="shrink-0">
                <LanguageSwitcher />
              </div>
              {!authenticated ? (
                <>
                  <Link
                    href="/login"
                    className="hidden rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-black text-slate-700 shadow-soft transition hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700 sm:inline-flex"
                  >
                    {t("ui.nav.login", "Log in")}
                  </Link>
                </>
              ) : (
                <form
                  action="/auth/logout"
                  method="post"
                  className="hidden sm:block"
                  onSubmit={() => clearPlannerDraftOnLogout(window.localStorage, window.sessionStorage)}
                >
                  <button
                    type="submit"
                    className="rounded-full border border-cloud bg-white px-4 py-2 text-sm font-black text-ink shadow-soft transition hover:-translate-y-0.5 hover:border-coral"
                  >
                    {t("ui.nav.logout", "Logout")}
                  </button>
                </form>
              )}
              {!authenticated ? (
                <Link href={planTripHref} className="hidden min-h-11 items-center rounded-xl bg-ocean px-4 py-2 text-sm font-bold text-white shadow-[0_8px_20px_rgba(27,154,170,0.18)] transition-colors hover:bg-[#167f8d] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/25 sm:inline-flex">
                  {planTripLabel}
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-w-0 pb-[calc(8.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>

        <RoamlyLocationTracker />

        <nav
          ref={bottomNavRef}
          aria-label="Mobile navigation"
          aria-hidden={bottomNavHidden || undefined}
          inert={bottomNavHidden ? true : undefined}
          className={`roamly-bottom-nav fixed inset-x-3 bottom-[max(0.55rem,env(safe-area-inset-bottom))] z-40 grid min-w-0 gap-0.5 overflow-hidden rounded-[1.4rem] border border-black/5 bg-white/88 p-1 shadow-[0_8px_28px_rgba(16,32,51,0.1)] backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none lg:hidden ${
            bottomNavHidden ? "pointer-events-none translate-y-[calc(100%+max(1rem,env(safe-area-inset-bottom)))]" : "translate-y-0"
          } ${authenticated ? "grid-cols-5" : "grid-cols-5"}`}
        >
          {mobileRoutes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              aria-current={isActive(pathname, route.href, mobileRoutes.map((item) => item.href)) ? "page" : undefined}
              className={`relative min-h-11 min-w-0 rounded-[1rem] px-1 py-2 text-center text-[0.68rem] font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/25 ${
                isActive(pathname, route.href, mobileRoutes.map((item) => item.href))
                  ? "bg-ink text-white"
                  : "text-slate-500"
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
