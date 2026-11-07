"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CircleDot, CirclePlus, Compass, House, List, Search, Tag, User } from "lucide-react";
import { I18nProvider, useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { TranslatedTextBoundary } from "@/components/i18n/TranslatedTextBoundary";
import { RoamlyLocationTracker } from "@/components/roamly/RoamlyLocationTracker";
import { ToastProvider } from "@/components/roamly/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { shouldLoadShellState } from "@/lib/roamly/appShellState";
import { countAlertsBadgeNotifications } from "@/lib/roamly/alertsBadge";
import { INFO_NOTIFICATION_TYPES } from "@/lib/roamly/alertsNotificationTypes";
import { resolveSelectedTrip } from "@/lib/roamly/notificationTrip";
import { resolveRoamlySelectedTrip } from "@/lib/roamly/selectedTrip";
import {
  isStalePreTripInfoNotification,
  notificationActionState,
  notificationActionStateForInfoCard
} from "@/lib/roamly/liveCompanion";
import { resolveTripTimezone, zoneForMath } from "@/lib/roamly/tripTimezone";
import { clearPlannerDraftOnLogout } from "@/lib/roamly/planDraftStorage";
import { ROAMLY_LAST_ACTIVITY_COOKIE } from "@/lib/roamly/sessionActivity";
import { primaryNavActiveHref } from "@/lib/roamly/shellNav";
import { animateSpringValue, type BuiSpringHandle } from "@/components/boardui/spring";

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
  const p = { size: 25, strokeWidth: 1.7, "aria-hidden": true } as const;
  if (/\/live\/?$/.test(href)) return <CircleDot {...p} />;
  if (href.startsWith("/trip/") || href === "/dashboard") return <List {...p} />;
  if (href === "/plan") return <CirclePlus {...p} />;
  if (href === "/finds") return <Search {...p} />;
  if (href === "/notifications") return <Bell {...p} />;
  if (href === "/account" || href === "/login") return <User {...p} />;
  if (href === "/pricing") return <Tag {...p} />;
  if (href.startsWith("/#")) return <Compass {...p} />;
  return <House {...p} />;
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
// Audit fix (2026-10-29 production-recovery): bookings (incl. the
// Gmail review page), explore, companion, pass and feedback were
// missing here, so those trip pages fell back to the legacy 5-tab bar
// while the itinerary showed this 4-tab bar — one app, two different
// bottom bars. They are app surfaces and mount the one tab bar.
const APP_TRIP_SURFACE = /^\/trip\/[^/]+(?:\/(?:live|event(?:\/[^/]+)?|country-info|place(?:\/[^/]+)?|directions(?:\/[^/]+)?|bookings(?:\/[^/]+)?|explore|companion|pass|feedback))?\/?$/;

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

/* Lane N round 2 (F1): /finds is a public marketing-adjacent page, so
   like /plan it does NOT flip isAppSurface (signed-out visitors keep
   the site header and marketing nav). For signed-in travelers it
   renders the one six-tab app bar instead of the legacy 5-item nav —
   the same treatment /plan already had, which /finds was missing. */
function isFindsSurface(pathname: string) {
  return pathname === "/finds" || pathname.startsWith("/finds/");
}

function AppTabIcon({ name }: { name: "itinerary" | "live" | "plan" | "finds" | "alerts" | "account" }) {
  const p = { size: 25, strokeWidth: 1.7, "aria-hidden": true } as const;
  if (name === "itinerary") return <List {...p} />;
  if (name === "live") return <CircleDot {...p} />;
  if (name === "plan") return <CirclePlus {...p} />;
  if (name === "finds") return <Search {...p} />;
  if (name === "alerts") return <Bell {...p} />;
  return <User {...p} />;
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
      // Lane N round 2 (F2): the bookings surfaces (Gmail review at
      // /trip/[id]/bookings and its /add child) belong to the owning
      // trip — the Itinerary tab, whose href already points at that
      // trip via the route param, is their active tab. Before this,
      // no tab was aria-current there.
      active: /^\/trip\/[^/]+\/?$/.test(pathname) || /^\/trip\/[^/]+\/event(\/|$)/.test(pathname) || /^\/trip\/[^/]+\/country-info\/?$/.test(pathname) || /^\/trip\/[^/]+\/place(\/|$)/.test(pathname) || /^\/trip\/[^/]+\/directions(\/|$)/.test(pathname) || /^\/trip\/[^/]+\/bookings(\/|$)/.test(pathname) || pathname === "/dashboard"
    },
    {
      href: liveHref,
      label: t("ui.nav.live", "Live"),
      icon: "live" as const,
      active: /^\/trip\/[^/]+\/live\/?$/.test(pathname)
    },
    // Jakob round (2026-11-03, A4): the app bar carries FIVE tabs —
    // Itinerary / Live / Deals / Alerts / Account (Material's 3–5
    // destination rule; six tabs at 390px left ~65px per tab).
    // "Plan trip" is no longer a tab: it is the persistent action
    // rendered above this bar (AppPlanTripAction) and, on header
    // surfaces, the header CTA. The /finds label is "Deals" (C6):
    // travellers meet Deals/Search in every reference app; "Finds"
    // was a brand word with no functional defence.
    {
      href: "/finds",
      label: t("ui.nav.finds", "Deals"),
      icon: "finds" as const,
      active: pathname === "/finds" || pathname.startsWith("/finds/")
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
  // Same duplicate-link fix as the mobile bar (consolidation
  // 2026-11-06): with no trip in frame, Itinerary and Live share
  // the /dashboard href — render the destination once.
  const visibleTabs = tabs.filter((tab, index) => tabs.findIndex((other) => other.href === tab.href) === index);
  /* Feels-right set + iPhone-feel springs (2026-11-04): the
   * selection PILL SLIDES between tabs on the foundation spring —
   * the eye follows it instead of jump-cutting (jump cuts make
   * people search). Position is written straight to the pill's DOM
   * node by two springs (x + width); the last active tab survives
   * shell remounts in sessionStorage so the slide stays honest,
   * and a resize re-seats the pill exactly (a viewport change is
   * not a tab change). Reduced motion: jumps, no travel. */
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const pillSprings = useRef<{ x: BuiSpringHandle; w: BuiSpringHandle } | null>(null);
  const activeIndex = visibleTabs.findIndex((tab) => tab.active);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    const pill = pillRef.current;
    if (!pill || activeIndex < 0) return;
    const activeEl = linkRefs.current[activeIndex];
    if (!activeEl) return;
    const geo = { x: activeEl.offsetLeft, y: activeEl.offsetTop, w: activeEl.offsetWidth, h: activeEl.offsetHeight };
    pill.style.top = `${geo.y}px`;
    pill.style.height = `${geo.h}px`;
    if (!pillSprings.current) {
      let start = geo;
      try {
        const last = Number(window.sessionStorage.getItem("bui:tabbar:last"));
        const lastEl = Number.isInteger(last) && last !== activeIndex ? linkRefs.current[last] : null;
        if (lastEl) start = { x: lastEl.offsetLeft, y: geo.y, w: lastEl.offsetWidth, h: geo.h };
      } catch {
        /* storage unavailable — start seated */
      }
      pill.style.opacity = "1";
      pillSprings.current = {
        x: animateSpringValue({
          from: start.x,
          to: geo.x,
          onFrame: (value) => {
            pill.style.transform = `translateX(${value}px)`;
          }
        }),
        w: animateSpringValue({
          from: start.w,
          to: geo.w,
          onFrame: (value) => {
            pill.style.width = `${value}px`;
          }
        })
      };
    }
    pillSprings.current.x.retarget(geo.x);
    pillSprings.current.w.retarget(geo.w);
    try {
      window.sessionStorage.setItem("bui:tabbar:last", String(activeIndex));
    } catch {
      /* storage unavailable */
    }
  }, [activeIndex]);

  useEffect(() => {
    const onResize = () => {
      const springs = pillSprings.current;
      const index = activeIndexRef.current;
      const el = index >= 0 ? linkRefs.current[index] : null;
      if (!springs || !el) return;
      // A viewport change is not a tab change: re-seat on the exact
      // geometry of the tab that is already active.
      springs.x.retarget(el.offsetLeft);
      springs.w.retarget(el.offsetWidth);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      pillSprings.current?.x.cancel();
      pillSprings.current?.w.cancel();
      pillSprings.current = null;
    };
  }, []);

  /* Notification bell (smooth details, 2026-11-04): when the
   * unread count CHANGES to a new positive value the bell swings
   * ±24° and settles (~760ms) and the badge pops — attention
   * without nagging, once per change, never a loop. */
  const [bellSwingKey, setBellSwingKey] = useState(0);
  const prevUnreadRef = useRef(unreadCount);
  useEffect(() => {
    if (unreadCount > 0 && unreadCount !== prevUnreadRef.current) {
      setBellSwingKey((current) => current + 1);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  return (
    <nav
      aria-label="App navigation"
      className={`roamly-app-tabbar fixed inset-x-0 bottom-0 z-40 grid min-w-0 ${visibleTabs.length === 4 ? "grid-cols-4" : "grid-cols-5"} border-t border-[rgba(8,123,255,0.16)] bg-white/70 px-2.5 pb-[max(0.3rem,env(safe-area-inset-bottom))] pt-[7px] shadow-[0_-1px_0_rgba(255,255,255,0.65)_inset,0_-12px_32px_rgba(7,30,85,0.08)] backdrop-blur-xl backdrop-saturate-150`}
    >
      <span
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 rounded-full bg-csoft"
        style={{ opacity: 0 }}
      />
      {visibleTabs.map((tab, tabIndex) => (
        <Link
          key={tab.href + tab.label}
          ref={(el) => {
            linkRefs.current[tabIndex] = el;
          }}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`bui-tap bui-tab-press relative flex min-h-11 min-w-0 flex-col items-center gap-[3px] whitespace-nowrap px-0 py-1 text-center text-[0.65rem] font-medium leading-tight tracking-[-0.01em] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 ${
            tab.active ? "text-chead" : "text-cgray2"
          }`}
        >
          {tab.icon === "alerts" ? (
            <span key={bellSwingKey} className={bellSwingKey > 0 ? "bui-bell-swing inline-flex" : "inline-flex"}>
              <AppTabIcon name={tab.icon} />
            </span>
          ) : (
            <AppTabIcon name={tab.icon} />
          )}
          {tab.label}
          {"count" in tab && tab.count ? (
            <span
              key={tab.count}
              className="bui-badge-pop absolute right-1 top-0 grid h-5 min-w-5 place-items-center rounded-full bg-chead px-1 text-[0.62rem] font-bold text-white"
            >
              {tab.count > 9 ? "9+" : tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/* Jakob round (2026-11-03, A4): "Plan trip" as the persistent action
   on app surfaces, which have no site header to carry the CTA. A
   labelled pill anchored above the app tab bar; hidden on /plan
   itself, where the traveller is already planning. */
function AppPlanTripAction({ pathname, t }: { pathname: string; t: (key: string, fallback?: string) => string }) {
  if (pathname === "/plan") return null;
  return (
    <Link
      href="/plan"
      className="fixed bottom-[calc(64px+env(safe-area-inset-bottom)+0.75rem)] right-4 z-40 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cblue px-4 py-2 text-sm font-bold text-white shadow-[0_10px_24px_rgba(8,123,255,0.35)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
    >
      <CirclePlus size={20} strokeWidth={1.9} aria-hidden />
      {t("ui.nav.planTrip", "Plan trip")}
    </Link>
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
  // Lane N round 2 (F4): the bar's trip is no longer the
  // companion-active id alone. The shell keeps the companion id, the
  // fetched trip list, and the Alerts page's bridge id as INPUTS and
  // derives the bar trip through the ONE resolver
  // (lib/roamly/selectedTrip.ts) at render (see frameTripId below).
  const [companionTripId, setCompanionTripId] = useState("");
  const [shellTrips, setShellTrips] = useState<Parameters<typeof resolveRoamlySelectedTrip>[0]["trips"][number][]>([]);
  const [shellTripsLoaded, setShellTripsLoaded] = useState(false);
  const [pageTripBridgeSeen, setPageTripBridgeSeen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Jakob round (2026-11-03, A4): the bottom nav no longer hides, so
  // the hidden-state machine (state + anchor refs) is gone entirely.


  useEffect(() => {
    setAuthenticated(initialAuth.authenticated);
  }, [initialAuth.authenticated]);

  // Inactivity expiry, client half (consolidation 2026-11-06,
  // Block D): while signed in, real activity stamps the
  // roamly_last_activity cookie the middleware reads — 30 days
  // without a stamp and the next load is signed out server-side.
  // Stamps are throttled (a stamp per minute is plenty of
  // resolution for a 30-day limit) and stop the moment the
  // session ends. See lib/roamly/sessionActivity.ts.
  useEffect(() => {
    if (!authenticated) return;
    let lastStamp = 0;
    const stamp = () => {
      const now = Date.now();
      if (now - lastStamp < 60_000) return;
      lastStamp = now;
      try {
        document.cookie = `${ROAMLY_LAST_ACTIVITY_COOKIE}=${now}; path=/; max-age=34560000; SameSite=Lax`;
      } catch {
        /* cookies unavailable — the server half never sees a stamp and never expires the session */
      }
    };
    stamp();
    const onActivity = () => stamp();
    const onVisible = () => {
      if (document.visibilityState === "visible") stamp();
    };
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authenticated]);

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
        setCompanionTripId("");
        setShellTrips([]);
        setShellTripsLoaded(false);
        setUnreadCount(0);
        return;
      }

      // Lane N round 2 (F4): the companion-active trip is now ONE
      // input to the shared resolver, not the bar's trip by itself.
      const activeResponse = await fetch("/api/roamly/trips/active").catch(() => null);

      if (!alive) return;

      if (activeResponse?.ok) {
        const data = await activeResponse.json().catch(() => null);
        setCompanionTripId(data?.activeTrip?.id || "");
      }

      // The trip list is fetched on every shell surface now (it used
      // to load only for the badge on non-trip surfaces): the ONE
      // resolver needs the same list the Alerts page selects from so
      // the bar and the page can never resolve different trips. A
      // failed fetch leaves the previous list/loaded state untouched
      // — the bar then keeps its interim hrefs instead of inventing
      // a different trip.
      const shellTripsResponse = await fetch("/api/roamly/trips").catch(() => null);

      if (!alive) return;

      let trips: Parameters<typeof resolveRoamlySelectedTrip>[0]["trips"][number][] = [];
      if (shellTripsResponse?.ok) {
        const shellTripsData = await shellTripsResponse.json().catch(() => null);
        trips = Array.isArray(shellTripsData?.trips) ? shellTripsData.trips : [];
        setShellTrips(trips);
        setShellTripsLoaded(true);
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
      if (!shellTripsResponse?.ok) {
        setUnreadCount(0);
        return;
      }

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

    // Lane N round 2 (F4): on /notifications the badge load above is
    // skipped by design (the page's bridge owns the badge), but the
    // BAR still needs the resolver's inputs. A fresh page load can
    // fire the bridge event before this shell's listener registers
    // (the F4 capture's Halifax page / /dashboard bar), so the shell
    // also loads the list itself here and resolves the same trip the
    // page's rule selects; the bridge, when it lands, wins outright
    // (see frameTripId).
    async function loadBarTrips() {
      if (!authenticated) return;
      const [activeResponse, tripsResponse] = await Promise.all([
        fetch("/api/roamly/trips/active").catch(() => null),
        fetch("/api/roamly/trips").catch(() => null)
      ]);
      if (!alive) return;
      if (activeResponse?.ok) {
        const data = await activeResponse.json().catch(() => null);
        setCompanionTripId(data?.activeTrip?.id || "");
      }
      if (tripsResponse?.ok) {
        const tripsData = await tripsResponse.json().catch(() => null);
        setShellTrips(Array.isArray(tripsData?.trips) ? tripsData.trips : []);
        setShellTripsLoaded(true);
      }
    }

    const handleNotificationShellState = (event: Event) => {
      if (pathname !== "/notifications") return;
      const detail = (event as CustomEvent<{ activeTripId?: unknown; unreadCount?: unknown }>).detail;
      setActiveTripId(typeof detail?.activeTripId === "string" ? detail.activeTripId : "");
      setPageTripBridgeSeen(true);
      setUnreadCount(typeof detail?.unreadCount === "number" && Number.isFinite(detail.unreadCount) ? detail.unreadCount : 0);
    };

    const handleShellStateRefresh = () => {
      void loadMobileState();
    };

    window.addEventListener("roamly:notifications-shell-state", handleNotificationShellState);
    window.addEventListener("roamly:shell-state-refresh", handleShellStateRefresh);
    if (shouldLoadShellState(authenticated, pathname)) void loadMobileState();
    else if (authenticated && pathname === "/notifications") void loadBarTrips();

    return () => {
      alive = false;
      window.removeEventListener("roamly:notifications-shell-state", handleNotificationShellState);
      window.removeEventListener("roamly:shell-state-refresh", handleShellStateRefresh);
    };
  }, [authenticated, pathname]);

  useEffect(() => {
    // The Alerts bridge value belongs to the /notifications render
    // that sent it; leaving the surface retires it.
    if (pathname !== "/notifications") setPageTripBridgeSeen(false);
  }, [pathname]);

  /* Jakob round (2026-11-03, A4): primary navigation NEVER hides.
     The scroll-hide behaviour (and the marketing home's "hidden for
     the first ~45% of the page" rule) is removed — a traveller must
     always be able to see how to get home. lib/roamly/bottomNavScroll.ts
     remains as a tested utility but the shell no longer consumes it. */

  const desktopRoutes = useMemo(
    () =>
        authenticated
        ? [
            { href: "/dashboard", label: t("ui.nav.trips", "Trips") },
            { href: "/plan", label: t("ui.nav.planTrip", "Plan trip") },
            { href: "/finds", label: t("ui.nav.finds", "Deals") },
            { href: "/notifications", label: t("ui.nav.alerts", "Alerts") },
            { href: "/account", label: t("ui.nav.account", "Account") }
          ]
        : [
            { href: "/", label: t("ui.nav.home", "Home") },
            { href: "/#the-journey", label: t("ui.nav.howItWorks", "How it works") },
            { href: "/plan", label: t("ui.nav.plan", "Plan") },
            { href: "/finds", label: t("ui.nav.finds", "Deals") },
            { href: "/pricing", label: t("ui.nav.pricing", "Pricing") }
          ],
    [authenticated, t]
  );

  // Jakob round (2026-11-03, A4): the signed-in mobile bar is built
  // after the trip resolution below (signedInMobileRoutes) so it can
  // carry the SAME five destinations/labels as the app tab bar. This
  // memo now holds only the signed-out marketing routes.
  const mobileRoutes = useMemo<Array<{ href: string; label: string; count?: number }>>(
    () =>
        authenticated
        ? []
        : [
            { href: "/", label: t("ui.nav.home", "Home") },
            { href: "/#the-journey", label: t("ui.nav.howItWorks", "How it works") },
            { href: "/plan", label: t("ui.nav.plan", "Plan") },
            { href: "/finds", label: t("ui.nav.finds", "Deals") },
            { href: "/pricing", label: t("ui.nav.pricing", "Pricing") },
            { href: "/login", label: t("ui.nav.login", "Log in") }
          ],
    [companionTripId, authenticated, t, unreadCount]
  );

  const planTripHref = "/plan";
  const planTripLabel = authenticated ? t("ui.nav.planTrip", "Plan trip") : t("ui.nav.startPlanning", "Start planning");

  // App frame: on app surfaces the site header and the marketing /
  // standard bottom nav are suppressed; the app tab bar is the only
  // navigation (see isAppSurface for the surface set).
  const appFrame = isAppSurface(pathname);
  // Lane N round 2 (F4): ONE selected-trip resolution for the bar —
  // lib/roamly/selectedTrip.ts, the same resolver the Alerts page
  // uses server-side. Priority: the route param (trip surfaces) >
  // the companion-active trip > the page's own trip > the
  // notification rule over the fetched list; /dashboard only when
  // the resolution is "none" (no open trip). Until the list has
  // loaded, the bar keeps the interim hrefs (route param, then
  // companion) rather than resolving against an empty list. On
  // /notifications the Alerts page's bridge value wins outright once
  // seen: the page server-verified that trip (including trips
  // outside the shell list's 40-row window, which the page fetches
  // directly), and its no-trip render bridges "" — the bar then
  // honestly falls back to /dashboard instead of pointing at a trip
  // the page is not showing (the F4 capture: Halifax in the page,
  // /dashboard in the bar, because a fresh-load bridge event could
  // fire before this shell's listener registered and the companion
  // rule could not see that trip at all).
  const frameResolution = resolveRoamlySelectedTrip({
    trips: shellTrips,
    routeTripId: appSurfaceTripId(pathname),
    companionTripId: companionTripId || null,
    pageTripId: pathname === "/notifications" ? activeTripId || null : null
  });
  let frameTripId = shellTripsLoaded
    ? frameResolution.tripId
    : appSurfaceTripId(pathname) || companionTripId || (pathname === "/notifications" ? activeTripId : "");
  if (pathname === "/notifications" && pageTripBridgeSeen) frameTripId = activeTripId;
  // Repair round P2: the Alerts tab keeps the viewed trip (trip
  // surface) or the Alerts page's own trip (bridge activeTripId on
  // /notifications); anywhere else it carries no trip, so the rule
  // selects — never a stale companion trip, never a flip.
  const alertsTripId = appSurfaceTripId(pathname) || (pathname === "/notifications" ? activeTripId : "");

  // Jakob round (2026-11-03, A4): ONE nav model for signed-in
  // travellers — the non-app mobile bar carries the same five
  // destinations and labels as the app tab bar (Itinerary / Live /
  // Deals / Alerts / Account). "Plan trip" lives in the header CTA
  // and the app-surface action pill, not in the bar. The old bar's
  // "Trip" / "Plan" labels are retired (NN/g: same words, same
  // meaning, everywhere).
  // Duplicate-link fix (consolidation 2026-11-06, Block H): with
  // no framed trip, Itinerary and Live BOTH fell back to
  // /dashboard — the dashboard's nav carried two links to the
  // page the traveller is already on (and React keys collided on
  // the shared href). Identical hrefs render once: Live without a
  // trip is not a destination, it is the trips list wearing a
  // second label. With a trip framed, all five destinations are
  // distinct and all five render, as the nav law requires.
  const signedInMobileRoutes: Array<{ href: string; label: string; count?: number }> = [
    { href: frameTripId ? `/trip/${frameTripId}` : "/dashboard", label: t("ui.nav.itinerary", "Itinerary") },
    { href: frameTripId ? `/trip/${frameTripId}/live` : "/dashboard", label: t("ui.nav.live", "Live") },
    { href: "/finds", label: t("ui.nav.finds", "Deals") },
    { href: alertsTripId ? `/notifications?trip=${encodeURIComponent(alertsTripId)}` : "/notifications", label: t("ui.nav.alerts", "Alerts"), count: unreadCount },
    { href: "/account", label: t("ui.nav.account", "Account") }
  ].filter((route, index, all) => all.findIndex((other) => other.href === route.href) === index);
  const visibleMobileRoutes = authenticated ? signedInMobileRoutes : mobileRoutes;

  return (
    <TranslatedTextBoundary>
      <div data-bottom-nav="visible" className={`roamly-app-shell min-h-dvh min-w-0 ${appFrame ? "bg-cbg" : "bg-[#F2F6FC]"} text-ink ${authenticated ? "roamly-authenticated" : ""}`}>
        {!appFrame ? (
        <header className="sticky top-0 z-30 border-b border-cloud/80 bg-white/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[0_8px_30px_rgba(16,32,51,0.04)] backdrop-blur-2xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            {/* Jakob round (2026-11-03, A3): ONE home rule. For a
                signed-in traveller the wordmark goes home — to the
                current trip inside one, else to /dashboard (trips).
                The marketing homepage is reached only from
                signed-out surfaces. It never again throws a
                traveller out of their trip to the sales page. */}
            <Link href={authenticated ? (frameTripId ? `/trip/${frameTripId}` : "/dashboard") : "/"} className="flex h-11 items-center gap-2" aria-label="Roamly home">
              <Image
                src="/roamly-wordmark@2x.png"
                alt="Roamly"
                width={150}
                height={62}
                priority
                className="block h-10 w-auto object-contain sm:h-12"
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
                    className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-black text-slate-700 shadow-soft transition hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700"
                  >
                    {t("ui.nav.login", "Log in")}
                  </Link>
                </>
              ) : (
                <form
                  action="/auth/logout"
                  method="post"
                  className="block"
                  onSubmit={() => clearPlannerDraftOnLogout(window.localStorage, window.sessionStorage)}
                >
                  <button
                    type="submit"
                    className="inline-flex min-h-11 items-center rounded-full border border-cloud bg-white px-4 py-2 text-sm font-black text-ink shadow-soft transition hover:-translate-y-0.5 hover:border-coral"
                  >
                    {t("ui.nav.logout", "Logout")}
                  </button>
                </form>
              )}
              {/* Jakob round (2026-11-03, A4): "Plan trip" is the
                  persistent header CTA for signed-in travellers too
                  (it left the tab bar; it does not leave reach). */}
              <Link href={planTripHref} className="hidden min-h-11 items-center rounded-xl bg-cblue px-4 py-2 text-sm font-bold text-white shadow-[0_8px_20px_rgba(8,123,255,0.18)] transition-colors hover:bg-[#071E55] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 sm:inline-flex">
                {planTripLabel}
              </Link>
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
            falls back to /dashboard links when no trip is active.
            Lane N round 2 (F1): /finds gets the identical treatment
            for signed-in travelers — before this it rendered the
            legacy 5-item nav (Trip/Plan trip/Finds/Alerts/Account)
            while every other app surface carried the six-tab bar.
            Exactly one bar renders on /finds: AppTabBar when
            signed in, the marketing nav when signed out.
            Jakob round (2026-11-03, A4): the bar is now FIVE tabs
            everywhere it renders, and the signed-in non-app bar
            carries the same five — one nav model, no exceptions. */}
        {/* Fix round item 3 (2026-11-06, audit D9): /dashboard is the
            trips home but NOT an app surface, so the branch below
            never mounted the "Plan trip" pill there — on a phone
            inside the account, "make another plan" had no persistent
            action (the header CTA is hidden below sm). Mount the SAME
            pill for the dashboard route, signed-in only — the same
            rule the /plan and /finds mounts below use. The dashboard
            keeps its header and its bottom bar; only the pill is
            added. The !appFrame guard keeps this from ever
            double-mounting the pill if the surface set changes; app
            surfaces get the pill from the branch below, trip pages
            are untouched, and /plan stays suppressed inside the
            component itself. */}
        {!appFrame && authenticated && pathname === "/dashboard" ? (
          <AppPlanTripAction pathname={pathname} t={t} />
        ) : null}
        {appFrame || (authenticated && pathname === "/plan") || (authenticated && isFindsSurface(pathname)) ? (
          <>
            <AppPlanTripAction pathname={pathname} t={t} />
            <AppTabBar pathname={pathname} tripId={frameTripId} alertsTripId={alertsTripId} unreadCount={unreadCount} t={t} />
          </>
        ) : (
        <nav
          aria-label="Mobile navigation"
          className={`roamly-bottom-nav fixed inset-x-0 bottom-0 z-40 grid min-w-0 px-1.5 pb-[max(0.3rem,env(safe-area-inset-bottom))] pt-[7px] lg:hidden ${authenticated ? `${visibleMobileRoutes.length === 4 ? "grid-cols-4" : "grid-cols-5"} border-t border-[rgba(8,123,255,0.16)] bg-white/70 shadow-[0_-1px_0_rgba(255,255,255,0.65)_inset,0_-12px_32px_rgba(7,30,85,0.08)] backdrop-blur-xl backdrop-saturate-150` : "grid-cols-6 border-t border-[rgba(61,78,109,0.28)] bg-white/95 backdrop-blur-[18px]"}`}
        >
          {visibleMobileRoutes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              aria-current={isActive(pathname, route.href, visibleMobileRoutes.map((item) => item.href)) ? "page" : undefined}
              className={`relative flex min-h-11 min-w-0 flex-col items-center gap-[3px] whitespace-nowrap px-0 py-1 text-center text-[0.65rem] font-medium leading-tight tracking-[-0.01em] transition max-[374px]:text-[0.59rem] max-[374px]:tracking-[-0.02em] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 ${
                isActive(pathname, route.href, visibleMobileRoutes.map((item) => item.href))
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
      {/* Jakob round (2026-11-03, C4): the global toast system
          (components/roamly/Toast.tsx) mounts around the whole
          shell so every surface — Delete Trip's Undo first — can
          raise one. */}
      <ToastProvider>
        <AppShellContent initialAuth={initialAuth}>{children}</AppShellContent>
      </ToastProvider>
    </I18nProvider>
  );
}
