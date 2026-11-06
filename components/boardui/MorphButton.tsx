/**
 * BoardUI MorphButton — Roamly foundation primitive (Smooth-Details
 * pass, 2026-11-04; micro-interaction set: "submit morph — the
 * action button shrinks pill → spinner → tick as ONE shape").
 *
 * A submit button whose silhouette is one continuous shape through
 * its whole story: at rest it is the caller's pill; when `phase`
 * becomes "busy" its WIDTH springs (spring.ts — the real
 * integrator, not a timed resize) down to a compact shape holding
 * a spinner; on "done" the spinner hands the same compact shape to
 * a tick that draws itself; back on "idle" the shape springs home.
 * Nothing swaps: the width, the fade and the tick are one element
 * travelling through states, and a phase change mid-travel
 * retargets the spring from wherever the shape currently is
 * (iPhone-feel rule 5 — interruptible; the caller's double-submit
 * LOGIC guard is untouched and is not an animation lock).
 *
 * Controlled: the caller owns the phase (its existing busy/success
 * state), this component owns the shape. The natural pill width is
 * measured from the button's own laid-out box while idle and only becomes an
 * explicit style once the shape has travelled at least once, so
 * first paint is the browser's own layout. Busy keeps the button
 * disabled exactly like BuiButton's busy contract. Reduced motion:
 * the spring lands instantly; states still read.
 */
"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useSpringNumber } from "./spring";
import { cx } from "./cx";

export type BuiMorphPhase = "idle" | "busy" | "done";

export interface BuiMorphButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  phase: BuiMorphPhase;
  /** Optional leading icon for the idle face (e.g. the send plane);
   *  it flies/fades with the morph — never a separate control. */
  icon?: ReactNode;
  children: ReactNode;
}

export function BuiMorphButton({ phase, icon, children, className, disabled, ...rest }: BuiMorphButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const compactRef = useRef(48);
  const [homeWidth, setHomeWidth] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);

  /* The home width is the button's NATURAL laid-out width, read
   * once from its own box before the shape first travels (in a
   * stretched column that is the full row; in a row it is the
   * content's width). It is deliberately never re-measured from
   * the content afterwards: inside the compact shape the content
   * is crushed to a few px, and a home width read there would
   * strand the button at compact size forever. */
  useEffect(() => {
    if (phase !== "idle") {
      setArmed(true);
      return;
    }
    const button = buttonRef.current;
    if (!button) return;
    compactRef.current = button.offsetHeight || compactRef.current;
    if (homeWidth === null) {
      setHomeWidth(Math.ceil(button.getBoundingClientRect().width));
    }
  }, [phase, children, icon, homeWidth]);

  const target = phase === "idle" || homeWidth === null ? (homeWidth ?? 0) : compactRef.current;
  const { value: width } = useSpringNumber(target, {
    stiffness: 320,
    dampingRatio: 0.8,
    initial: homeWidth ?? 0,
    restDelta: 0.1,
    restVelocity: 4
  });

  return (
    <button
      ref={buttonRef}
      type="submit"
      disabled={disabled || phase !== "idle"}
      aria-busy={phase === "busy" || undefined}
      data-bui-morph-phase={phase}
      className={cx(
        "bui-press bui-tap relative inline-flex min-h-11 select-none items-center justify-center overflow-hidden whitespace-nowrap rounded-full font-semibold",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 disabled:opacity-90",
        className
      )}
      style={armed && homeWidth !== null ? { width: `${Math.max(width, compactRef.current)}px` } : undefined}
      {...rest}
    >
      <span
        className="inline-flex items-center gap-2 transition-opacity duration-150"
        style={{ opacity: phase === "idle" ? 1 : 0 }}
      >
        {icon}
        {children}
      </span>
      <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
        {phase === "busy" ? (
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 animate-spin">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path d="M22 12a10 10 0 0 0-10-10v4a6 6 0 0 1 6 6h4z" fill="currentColor" className="opacity-90" />
          </svg>
        ) : phase === "done" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              strokeDasharray={22}
              strokeDashoffset={0}
              style={{ animation: "bui-tick-draw 300ms var(--bui-ease) both" }}
            />
          </svg>
        ) : null}
      </span>
    </button>
  );
}
