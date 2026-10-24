"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  houseAdCandidates,
  houseAdClickPath,
  houseAdRotationAllowed,
  nextHouseAdIndex,
  pickHouseAd,
  type HouseAdContext,
  type HouseAdCreative,
} from "@/lib/houseAds";

/**
 * House Ads Engine (Phase 1 + FX) — the sponsored photo card.
 *
 * Photo, headline, sponsor line, a visible "Sponsored" label, and a close
 * (X) that hides the slot for the session. The whole card is one tap
 * through /api/ads/click/<id> (records, then redirects).
 *
 * Motion (Apple-like restraint — fades only, no bounce, no sliding):
 * - Entrance: the first time the slot scrolls into view it fades in with
 *   a soft rise (~600ms ease-out).
 * - Rotation: while the slot stays on screen it crossfades to the next
 *   creative in its context family every 15 seconds (~500ms; the
 *   outgoing card fades and settles back a touch). All creatives render
 *   in one stacked grid cell, so the box never changes size mid-fade.
 * - Rotation pauses when the tab is hidden, the slot is off-screen, the
 *   pointer is hovering, or the card was dismissed. With
 *   prefers-reduced-motion the swap is instant — no animation at all.
 *
 * Counting stays honest: an impression fires through POST /api/ads/event
 * for each creative at the moment it is the visible one with the slot at
 * least half in view (same once-per-session-per-placement rule as Phase
 * 1; the server dedupes per visitor for 30 minutes).
 *
 * Test-only override: setting window.__HOUSE_AD_FX__ = { rotateMs,
 * fadeMs, enterMs } before the slot mounts retimes the effects (used to
 * capture proof frames); production always uses the defaults below.
 */

const HIDE_KEY = "house-ad-hidden:";
const IMP_KEY = "house-ad-impression:";

const ROTATE_MS = 15_000;
const FADE_MS = 500;
const ENTER_MS = 600;

type HouseAdFxTiming = { rotateMs: number; fadeMs: number; enterMs: number };
const DEFAULT_FX: HouseAdFxTiming = {
  rotateMs: ROTATE_MS,
  fadeMs: FADE_MS,
  enterMs: ENTER_MS,
};

function fxTimingOverride(): Partial<HouseAdFxTiming> {
  try {
    const raw = (
      window as unknown as { __HOUSE_AD_FX__?: Partial<HouseAdFxTiming> }
    ).__HOUSE_AD_FX__;
    if (!raw || typeof raw !== "object") return {};
    const clean: Partial<HouseAdFxTiming> = {};
    for (const key of ["rotateMs", "fadeMs", "enterMs"] as const) {
      const value = raw[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        clean[key] = value;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function sessionGet(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function sessionSet(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* private mode — counting/dismissal just becomes per-render */
  }
}

function sendHouseAdImpression(creativeId: string) {
  const payload = JSON.stringify({
    creativeId,
    eventType: "impression",
    pagePath: window.location.pathname,
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/ads/event",
        new Blob([payload], { type: "application/json" }),
      );
      return;
    }
  } catch {
    /* fall through to fetch */
  }
  fetch("/api/ads/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export function HouseAdCard({
  creative,
  onDismiss,
  focusable = true,
}: {
  creative: HouseAdCreative;
  onDismiss: () => void;
  focusable?: boolean;
}) {
  return (
    <aside
      aria-label={`Sponsored: ${creative.sponsorLabel}`}
      className="relative h-full overflow-hidden rounded-[1.75rem] bg-white shadow-[0_24px_60px_rgba(39,88,80,0.10)] ring-1 ring-[#d8e5dd]"
      data-house-ad={creative.id}
    >
      <a
        href={houseAdClickPath(creative.id)}
        rel="sponsored noopener"
        tabIndex={focusable ? undefined : -1}
        className="group flex h-full flex-row sm:min-h-44"
      >
        <span className="relative block w-28 shrink-0 overflow-hidden min-[420px]:w-32 sm:w-64">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={creative.image}
            alt={creative.imageAlt}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3.5 pe-11 sm:gap-1.5 sm:p-6">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f6e66]">
            {creative.sponsorLabel}
          </span>
          <span className="line-clamp-2 text-base font-bold leading-snug text-ink sm:line-clamp-none sm:text-xl">
            {creative.headline}
          </span>
          <span className="line-clamp-1 text-[13px] leading-snug text-slate-600 sm:line-clamp-none sm:text-sm sm:leading-relaxed">{creative.body}</span>
          <span className="mt-1.5 inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-[#0f6e66] px-3 py-1.5 text-[13px] font-bold text-white transition group-hover:bg-[#0e605a] sm:mt-2 sm:px-4 sm:py-2 sm:text-sm">
            {creative.ctaLabel}
            <span aria-hidden="true">→</span>
          </span>
        </span>
      </a>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-2 whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white backdrop-blur-sm sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[11px]"
      >
        Sponsored
      </span>
      <button
        type="button"
        onClick={onDismiss}
        tabIndex={focusable ? undefined : -1}
        aria-label="Hide this sponsored card"
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-base leading-none text-white backdrop-blur-sm transition hover:bg-black/65"
      >
        ×
      </button>
    </aside>
  );
}

/** Renders the placement's context family as one stacked stage and runs
 * the entrance + rotation effects. The first creative is the hourly-seed
 * pick (same even share as Phase 1); rotation then walks the family in
 * order from there. */
export function HouseAdSlot({
  context,
  placement,
  className,
}: {
  context: HouseAdContext;
  placement?: string;
  className?: string;
}) {
  const place = placement || context;
  const candidates = useMemo(() => houseAdCandidates(context), [context]);
  const seed = useMemo(() => Math.floor(Date.now() / 3_600_000), []);
  const startIndex = useMemo(() => {
    const first = pickHouseAd(context, seed);
    const index = first ? candidates.findIndex((c) => c.id === first.id) : 0;
    return index >= 0 ? index : 0;
  }, [candidates, context, seed]);

  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(startIndex);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [entered, setEntered] = useState(false);
  const [inView, setInView] = useState(false);
  const [halfView, setHalfView] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [docHidden, setDocHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fx, setFx] = useState<HouseAdFxTiming>(DEFAULT_FX);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef<Set<string>>(new Set());
  const fadeTimerRef = useRef<number | null>(null);

  /* Session dismissal state, reduced-motion preference, and test-only
   * timing overrides — all read once after mount. */
  useEffect(() => {
    if (sessionGet(HIDE_KEY + place)) setDismissed(true);
    setFx({ ...DEFAULT_FX, ...fxTimingOverride() });
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);
    const onMedia = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener?.("change", onMedia);
    const onVisibility = () => setDocHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      media.removeEventListener?.("change", onMedia);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [place]);

  /* One observer drives the entrance, the rotation's on-screen gate, and
   * the impression's half-in-view gate. */
  useEffect(() => {
    const node = stageRef.current;
    if (!node || dismissed) return;
    if (typeof IntersectionObserver === "undefined") {
      setEntered(true);
      setInView(true);
      setHalfView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
          if (entry.isIntersecting) setEntered(true);
          setHalfView(entry.isIntersecting && entry.intersectionRatio >= 0.5);
        }
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [dismissed]);

  /* Impression: fired for the creative that is actually showing, at the
   * moment the slot is at least half in view with that creative active —
   * once per session per placement+creative, exactly as Phase 1. */
  useEffect(() => {
    if (!halfView || dismissed) return;
    const creative = candidates[active];
    if (!creative) return;
    const impKey = `${IMP_KEY}${place}:${creative.id}`;
    if (firedRef.current.has(impKey)) return;
    firedRef.current.add(impKey);
    if (sessionGet(impKey)) return;
    sessionSet(impKey, "1");
    sendHouseAdImpression(creative.id);
  }, [halfView, active, dismissed, candidates, place]);

  /* Rotation: advance every rotateMs while the house rules allow it;
   * crossfade by keeping the outgoing card stacked under the incoming
   * one for fadeMs, then dropping it. */
  const rotationAllowed = houseAdRotationAllowed({
    documentHidden: docHidden,
    inView,
    hovered,
    dismissed,
    candidateCount: candidates.length,
  });
  useEffect(() => {
    if (!rotationAllowed || leaving !== null) return;
    const timer = window.setTimeout(
      () => {
        const next = nextHouseAdIndex(active, candidates.length);
        if (reducedMotion) {
          setActive(next);
          return;
        }
        setLeaving(active);
        setActive(next);
        fadeTimerRef.current = window.setTimeout(
          () => setLeaving(null),
          fx.fadeMs,
        );
      },
      fx.rotateMs,
    );
    return () => window.clearTimeout(timer);
  }, [rotationAllowed, leaving, active, candidates.length, reducedMotion, fx]);

  useEffect(
    () => () => {
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
      }
    },
    [],
  );

  if (dismissed || !candidates.length) return null;

  const dismiss = () => {
    sessionSet(HIDE_KEY + place, "1");
    setDismissed(true);
  };

  return (
    <div className={className}>
      <div
        ref={stageRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="grid"
        style={{
          opacity: entered || reducedMotion ? 1 : 0,
          transform: entered || reducedMotion ? "translateY(0px)" : "translateY(8px)",
          transitionProperty: "opacity, transform",
          transitionDuration: reducedMotion ? "0ms" : `${fx.enterMs}ms`,
          transitionTimingFunction: "ease-out",
        }}
      >
        {candidates.map((creative, index) => {
          const isActive = index === active;
          const isLeaving = index === leaving;
          const shown = isActive || isLeaving;
          return (
            <div
              key={creative.id}
              aria-hidden={!isActive}
              className="col-start-1 row-start-1 min-w-0"
              style={{
                opacity: isActive ? 1 : 0,
                transform: isLeaving ? "scale(0.98)" : "scale(1)",
                visibility: shown ? "visible" : "hidden",
                pointerEvents: isActive ? "auto" : "none",
                zIndex: isActive ? 2 : isLeaving ? 1 : 0,
                transitionProperty: "opacity, transform",
                transitionDuration: reducedMotion ? "0ms" : `${fx.fadeMs}ms`,
                transitionTimingFunction: "ease-in-out",
              }}
            >
              <HouseAdCard
                creative={creative}
                onDismiss={dismiss}
                focusable={isActive}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
