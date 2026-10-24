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

/* Tab-bar glyphs in the calm language (owner design, 2026-10-23):
   one 25px stroke style for every destination, color inherited from
   the tab (navy-slate when active, blue-shifted gray when not). */
function NavIcon({ href }: { href: string }) {
  const common = {
    width: 25,
    height: 25,
    viewBox: "0 0 25 25",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  } as const;
  if (href.startsWith("/trip/") || href === "/dashboard") {
    return (
      <svg {...common}>
        <circle cx="5" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="5" cy="12.5" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="5" cy="18.5" r="1.15" fill="currentColor" stroke="none" />
        <path d="M9.5 6.5h10M9.5 12.5h10M9.5 18.5h10" />
      </svg>
    );
  }
  if (href === "/plan") {
    return (
      <svg {...common}>
        <circle cx="12.5" cy="12.5" r="8" />
        <path d="M12.5 8.5v8M8.5 12.5h8" />
      </svg>
    );
  }
  if (href === "/finds") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" />
      </svg>
    );
  }
  if (href === "/notifications") {
    return (
      <svg {...common}>
        <path d="M12.5 3.5a5.5 5.5 0 0 1 5.5 5.5c0 4 1.2 5.4 2 6.5H5c.8-1.1 2-2.5 2-6.5a5.5 5.5 0 0 1 5.5-5.5" />
        <path d="M10.3 19.5a2.3 2.3 0 0 0 4.4 0" />
      </svg>
    );
  }
  if (href === "/account" || href === "/login") {
    return (
      <svg {...common}>
        <circle cx="12.5" cy="8.5" r="3.6" />
        <path d="M5.5 20a7.2 7.2 0 0 1 14 0" />
      </svg>
    );
  }
  if (href === "/pricing") {
    return (
      <svg {...common}>
        <path d="M4 4h7l9 9-7 7-9-9V4z" />
        <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (href.startsWith("/#")) {
    return (
      <svg {...common}>
        <circle cx="12.5" cy="12.5" r="8" />
        <path d="M15.5 9.5l-2 5-5 2 2-5z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 11.5L12.5 4.5L20 11.5" />
      <path d="M7 10v9.5h11V10" />
    </svg>
  );
}

function routeHidesBottomNav(pathname: string) {
  return pathname === "/plan";
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
  const [bottomNavHidden, setBottomNavHidden] = useState(pathname === "/" || routeHidesBottomNav(pathname));
  const bottomNavRef = useRef<HTMLElement>(null);
  const bottomNavHiddenRef = useRef(pathname === "/" || routeHidesBottomNav(pathname));
  const bottomNavAnchorRef = useRef(0);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

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
    const hideForRoute = routeHidesBottomNav(pathname) || (pathname === "/" && window.scrollY < window.innerHeight * 0.45);
    bottomNavAnchorRef.current = window.scrollY;
    bottomNavHiddenRef.current = hideForRoute;
    setBottomNavHidden(hideForRoute);
  }, [pathname]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (routeHidesBottomNav(pathnameRef.current) || (pathnameRef.current === "/" && window.scrollY < window.innerHeight * 0.45)) {
          bottomNavAnchorRef.current = window.scrollY;
          if (!bottomNavHiddenRef.current) {
            bottomNavHiddenRef.current = true;
            setBottomNavHidden(true);
          }
          return;
        }
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
            { href: "/pricing", label: t("ui.nav.pricing", "Pricing") },
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
                    className="inline-flex rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-black text-slate-700 shadow-soft transition hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700"
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

        <main className={`min-w-0 lg:pb-0 ${routeHidesBottomNav(pathname) ? "pb-[max(2rem,env(safe-area-inset-bottom))]" : "pb-[calc(8.75rem+env(safe-area-inset-bottom))]"}`}>
          {children}
        </main>

        <RoamlyLocationTracker />

        <nav
          ref={bottomNavRef}
          aria-label="Mobile navigation"
          aria-hidden={bottomNavHidden || undefined}
          inert={bottomNavHidden ? true : undefined}
          className={`roamly-bottom-nav fixed inset-x-0 bottom-0 z-40 grid min-w-0 border-t border-[rgba(61,78,109,0.28)] bg-white/95 px-1.5 pb-[max(0.3rem,env(safe-area-inset-bottom))] pt-[7px] backdrop-blur-[18px] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none lg:hidden ${
            bottomNavHidden ? "pointer-events-none translate-y-[calc(100%+max(1rem,env(safe-area-inset-bottom)))]" : "translate-y-0"
          } ${authenticated ? "grid-cols-5" : "grid-cols-6"}`}
        >
          {mobileRoutes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              aria-current={isActive(pathname, route.href, mobileRoutes.map((item) => item.href)) ? "page" : undefined}
              className={`relative flex min-h-11 min-w-0 flex-col items-center gap-[3px] whitespace-nowrap px-0 py-1 text-center text-[0.65rem] font-medium leading-tight tracking-[-0.01em] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 ${
                isActive(pathname, route.href, mobileRoutes.map((item) => item.href))
                  ? "text-chead"
                  : "text-cgray2"
              }`}
            >
              <NavIcon href={route.href} />
              {route.label}
              {"count" in route && route.count ? (
                <span className="absolute right-1 top-0 grid h-5 min-w-5 place-items-center rounded-full bg-chead px-1 text-[0.62rem] font-bold text-white">
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
