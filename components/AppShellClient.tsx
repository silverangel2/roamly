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
import { shouldLoadShellState } from "@/lib/roamly/appShellState";
import { countAlertsBadgeNotifications } from "@/lib/roamly/alertsBadge";
import { INFO_NOTIFICATION_TYPES } from "@/lib/roamly/alertsNotificationTypes";
import { resolveSelectedTrip } from "@/lib/roamly/notificationTrip";
import {
  isStalePreTripInfoNotification,
  notificationActionState,
  notificationActionStateForInfoCard
} from "@/lib/roamly/liveCompanion";
import { resolveTripTimezone, zoneForMath } from "@/lib/roamly/tripTimezone";
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
  // Correction phase (D8, 2026-10-28): /plan used to hide the mobile
  // bottom nav entirely, leaving phone travelers with no visible
  // navigation on the Plan page (audit F1). The plan form has no
  // sticky footer that the bar would collide with, and the main
  // column already reserves bottom clearance on non-app surfaces, so
  // no route hides the bar anymore. Kept as a function so the call
  // sites (scroll-hide logic, main padding) keep one decision point.
  void pathname;
  return false;
}

/* ——— App frame (owner design, 2026-10-23 truth rebuild) ———
   The blessed screens are APP frames: no site header, no marketing
   bottom nav — the app tab bar (Itinerary / Live / Alerts / Account)
   is the only navigation. The matcher below defines the app-surface
   set: a trip home (/trip/[id]), its Live Companion
   (/trip/[id]/live), its single-event sheets
   (/trip/[id]/event/[eventId]), its country-info panel
   (/trip/[id]/country-info), its place-detail pages
   (/trip/[id]/place/[placeId]), and its standalone directions
   screens (/trip/[id]/directions/[placeId], Picture 7 — the
   picture's tab bar shows Itinerary active there, as on place
   detail), /notifications and /account.
   Marketing pages never match and keep their chrome. */
const APP_TRIP_SURFACE = /^\/trip\/[^/]+(?:\/(?:live|event(?:\/[^/]+)?|country-info|place(?:\/[^/]+)?|directions(?:\/[^/]+)?))?\/?$/;

function isAppSurface(pathname: string) {
  return (
    APP_TRIP_SURFACE.test(pathname) ||
    pathname === "/notifications" ||
    pathname.startsWith("/notifications/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/")
  );
}

function appSurfaceTripId(pathname: string) {
  const match = pathname.match(/^\/trip\/([^/]+)/);
  return match ? match[1] : null;
}

function AppTabIcon({ name }: { name: "itinerary" | "live" | "alerts" | "account" }) {
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
  if (name === "itinerary") {
    return (
      <svg {...common}>
        <circle cx="5" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="5" cy="12.5" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="5" cy="18.5" r="1.15" fill="currentColor" stroke="none" />
        <path d="M9.5 6.5h10M9.5 12.5h10M9.5 18.5h10" />
      </svg>
    );
  }
  if (name === "live") {
    return (
      <svg {...common}>
        <circle cx="12.5" cy="12.5" r="7.5" />
        <circle cx="12.5" cy="12.5" r="2.6" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "alerts") {
    return (
      <svg {...common}>
        <path d="M12.5 3.5a5.5 5.5 0 0 1 5.5 5.5c0 4 1.2 5.4 2 6.5H5c.8-1.1 2-2.5 2-6.5a5.5 5.5 0 0 1 5.5-5.5" />
        <path d="M10.3 19.5a2.3 2.3 0 0 0 4.4 0" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12.5" cy="8.5" r="3.6" />
      <path d="M5.5 20a7.2 7.2 0 0 1 14 0" />
    </svg>
  );
}

function AppTabBar({
  pathname,
  tripId,
  alertsTripId,
  unreadCount,
  t
}: {
  pathname: string;
  tripId: string;
  /** Trip the Alerts tab must keep showing, or "" for the rule trip:
      the viewed trip on trip surfaces, the Alerts page's own trip on
      /notifications, and "" elsewhere (Account, dashboard) so the
      rule — not a stale companion trip — selects there. Without this
      the Alerts tab would flip a Toronto view back to Montreal. */
  alertsTripId: string;
  unreadCount: number;
  t: (key: string, fallback?: string) => string;
}) {
  const itineraryHref = tripId ? `/trip/${tripId}` : "/dashboard";
  const liveHref = tripId ? `/trip/${tripId}/live` : "/dashboard";
  const alertsHref = alertsTripId ? `/notifications?trip=${encodeURIComponent(alertsTripId)}` : "/notifications";
  const tabs = [
    {
      href: itineraryHref,
      label: t("ui.nav.itinerary", "Itinerary"),
      icon: "itinerary" as const,
      active: /^\/trip\/[^/]+\/?$/.test(pathname) || /^\/trip\/[^/]+\/event(\/|$)/.test(pathname) || /^\/trip\/[^/]+\/country-info\/?$/.test(pathname) || /^\/trip\/[^/]+\/place(\/|$)/.test(pathname) || /^\/trip\/[^/]+\/directions(\/|$)/.test(pathname) || pathname === "/dashboard"
    },
    {
      href: liveHref,
      label: t("ui.nav.live", "Live"),
      icon: "live" as const,
      active: /^\/trip\/[^/]+\/live\/?$/.test(pathname)
    },
    {
      href: alertsHref,
      label: t("ui.nav.alerts", "Alerts"),
      icon: "alerts" as const,
      active: pathname === "/notifications" || pathname.startsWith("/notifications/"),
      count: unreadCount
    },
    {
      href: "/account",
      label: t("ui.nav.account", "Account"),
      icon: "account" as const,
      active: pathname === "/account" || pathname.startsWith("/account/")
    }
  ];
  return (
    <nav
      aria-label="App navigation"
      className="roamly-app-tabbar fixed inset-x-0 bottom-0 z-40 grid min-w-0 grid-cols-4 border-t border-[rgba(61,78,109,0.28)] bg-white/95 px-2.5 pb-[max(0.3rem,env(safe-area-inset-bottom))] pt-[7px] backdrop-blur-[18px]"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href + tab.label}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`relative flex min-h-11 min-w-0 flex-col items-center gap-[3px] whitespace-nowrap px-0 py-1 text-center text-[0.65rem] font-medium leading-tight tracking-[-0.01em] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 ${
            tab.active ? "text-chead" : "text-cgray2"
          }`}
        >
          <AppTabIcon name={tab.icon} />
          {tab.label}
          {"count" in tab && tab.count ? (
            <span className="absolute right-1 top-0 grid h-5 min-w-5 place-items-center rounded-full bg-chead px-1 text-[0.62rem] font-bold text-white">
              {tab.count > 9 ? "9+" : tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
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

      // Itinerary/Live tab hrefs still follow the companion-active trip.
      const activeResponse = await fetch("/api/roamly/trips/active").catch(() => null);

      if (!alive) return;

      if (activeResponse?.ok) {
        const data = await activeResponse.json().catch(() => null);
        setActiveTripId(data?.activeTrip?.id || "");
      }

      // Badge (conditional-acceptance item 2 + repair round item P2 +
      // timezone round Priority 2): ONE semantics, shared with the
      // Alerts page — unread alerts shown on the Alerts screen for
      // the selected trip, counted by lib/roamly/alertsBadge.ts.
      // When the user is viewing a trip surface, the badge comes from
      // /api/roamly/badge?tripId=<that trip> — a DIRECT trip lookup,
      // so a selected trip beyond the newest-40 list window still
      // gets its own correct badge (the old list fetch capped at 40
      // and fell back to the rule trip for the badge only). Only
      // when no trip surface is viewed does the shell resolve the
      // rule trip from the list and count client-side. There is no
      // all-trips fallback anymore: when no selected trip resolves,
      // or any fetch fails, the honest count is 0 and the badge hides
      // — never a stale number. On /notifications itself the page's
      // bridge overrides with its own same-rule count (see below).
      const surfaceTripId = appSurfaceTripId(pathname);
      if (surfaceTripId) {
        const badgeResponse = await fetch(
          `/api/roamly/badge?tripId=${encodeURIComponent(surfaceTripId)}`
        ).catch(() => null);
        if (!alive) return;
        const badgeData = badgeResponse?.ok ? await badgeResponse.json().catch(() => null) : null;
        setUnreadCount(
          badgeData && typeof badgeData.unreadCount === "number" && Number.isFinite(badgeData.unreadCount)
            ? badgeData.unreadCount
            : 0
        );
        return;
      }
      const tripsResponse = await fetch("/api/roamly/trips").catch(() => null);

      if (!alive) return;

      if (!tripsResponse?.ok) {
        setUnreadCount(0);
        return;
      }

      const tripsData = await tripsResponse.json().catch(() => null);
      const trips = Array.isArray(tripsData?.trips) ? tripsData.trips : [];
      const selected = resolveSelectedTrip({ trips, urlTripId: appSurfaceTripId(pathname) });

      if (!selected) {
        setUnreadCount(0);
        return;
      }

      const notificationsResponse = await fetch(
        `/api/roamly/notifications?tripId=${encodeURIComponent(selected.id)}`
      ).catch(() => null);

      if (!alive) return;

      if (!notificationsResponse?.ok) {
        setUnreadCount(0);
        return;
      }

      const notificationsData = await notificationsResponse.json().catch(() => null);
      const rows: Array<Record<string, unknown>> = Array.isArray(notificationsData?.notifications)
        ? notificationsData.notifications
        : [];
      const lifecycle = {
        status: selected.status ?? null,
        itineraryStatus: selected.itinerary_status ?? null,
        startDate: selected.start_date ?? null,
        endDate: selected.end_date ?? null,
        metadata: selected.metadata
      };
      // Timezone round: the rule-path outdated gate resolves through
      // the ONE client-safe resolver (metadata + destination
      // registry), not metadata-only — the list rows now carry
      // destination columns for exactly this (see /api/roamly/trips).
      const timezone = zoneForMath(resolveTripTimezone({
        metadata: selected.metadata,
        destination: (selected as { destination?: unknown }).destination,
        destination_name: (selected as { destination_name?: unknown }).destination_name,
        destination_city: (selected as { destination_city?: unknown }).destination_city
      }));
      const annotated = rows.map((row) => {
        const type = typeof row.type === "string" ? row.type : "";
        const actionUrl = typeof row.action_url === "string" ? row.action_url : null;
        const actionState = INFO_NOTIFICATION_TYPES.has(type)
          ? notificationActionStateForInfoCard({ actionUrl, trip: lifecycle })
          : notificationActionState({ actionUrl, trip: lifecycle });
        return {
          ...row,
          action_state: actionState,
          is_outdated: isStalePreTripInfoNotification({
            type,
            startDate: lifecycle.startDate,
            endDate: lifecycle.endDate,
            timezone
          })
        };
      });
      setUnreadCount(countAlertsBadgeNotifications(annotated));
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

  // App frame: on app surfaces the site header and the marketing /
  // standard bottom nav are suppressed; the app tab bar is the only
  // navigation (see isAppSurface for the surface set).
  const appFrame = isAppSurface(pathname);
  const frameTripId = appSurfaceTripId(pathname) || activeTripId;
  // Repair round P2: the Alerts tab keeps the viewed trip (trip
  // surface) or the Alerts page's own trip (bridge activeTripId on
  // /notifications); anywhere else it carries no trip, so the rule
  // selects — never a stale companion trip, never a flip.
  const alertsTripId = appSurfaceTripId(pathname) || (pathname === "/notifications" ? activeTripId : "");

  return (
    <TranslatedTextBoundary>
      <div data-bottom-nav={bottomNavHidden ? "hidden" : "visible"} className={`roamly-app-shell min-h-dvh min-w-0 ${appFrame ? "bg-cbg" : "bg-[#fbf8ef]"} text-ink ${authenticated ? "roamly-authenticated" : ""}`}>
        {!appFrame ? (
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
        ) : null}

        {/* Owner-10 Item 1 — bottom-nav clearance, stated as the spec's
            own numbers so it can be checked, not just felt: the fixed
            tab bar is 64px tall (spec §2, measured 62px in a 390px
            viewport with safe-area 0) plus the iPhone safe area, and
            the main column clears it by 64px + 2.5rem of breathing
            room + the safe area (= 104px + safe area, the value this
            rule carried before, now derived in the open). Every app
            surface (the 8 screens) renders inside this main element,
            so this one rule is every screen's bottom padding; the bar
            itself already pads with env(safe-area-inset-bottom).
            Verified by viewport captures scrolled to each screen's
            bottom: the last content sits above the bar on all 8. */}
        <main className={appFrame ? "min-w-0 pb-[calc(64px+2.5rem+env(safe-area-inset-bottom))]" : `min-w-0 lg:pb-0 ${routeHidesBottomNav(pathname) ? "pb-[max(2rem,env(safe-area-inset-bottom))]" : "pb-[calc(8.75rem+env(safe-area-inset-bottom))]"}`}>
          {children}
        </main>

        <RoamlyLocationTracker />

        {/* Follow-up fix (2026-10-29, D8 reopened): the correction phase
            made routeHidesBottomNav always return false, but the app tab
            bar never RENDERED on /plan because /plan is not an app
            surface — the marketing nav rendered instead (and is
            lg:hidden, so desktop showed no bottom bar at all). Render
            the app tab bar on /plan for signed-in travelers WITHOUT
            flipping appFrame, so the wizard keeps its site header,
            background, and main padding. Signed-out visitors keep the
            marketing nav (their funnel links). The wizard's
            Back/Continue controls are in-flow, not a sticky footer,
            and the plan page already carries .safe-bottom clearance,
            so the fixed 64px bar cannot collide with them. AppTabBar
            falls back to /dashboard links when no trip is active. */}
        {appFrame || (authenticated && pathname === "/plan") ? (
          <AppTabBar pathname={pathname} tripId={frameTripId} alertsTripId={alertsTripId} unreadCount={unreadCount} t={t} />
        ) : (
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
        )}
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
