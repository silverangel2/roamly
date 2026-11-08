/**
 * BoardUI EnterContent — content arrives on the house spring: a
 * short rise + fade, interruptible and retargetable, landing with
 * the owner's ~1.5% overshoot breath (spring.ts, ζ = 0.8). Used
 * for prompt-step transitions: when a step's content appears — or
 * its `enterKey` changes because the traveller's answers branched
 * it — the new face springs in instead of snapping.
 *
 * PATTERN PORTED from React Bits `AnimatedContent` (DavidHDev/
 * react-bits, MIT + Commons Clause License Condition v1.0 —
 * verified from the repo's LICENSE.md, 2026-11-08; Copyright (c)
 * 2026 David Haz; use as part of an application is expressly
 * permitted, the components themselves are never sold or
 * redistributed). The API shape (distance / opacity / stagger
 * delay / mount trigger) is AnimatedContent's; the implementation
 * is Roamly's own, on components/boardui/spring.ts — upstream's
 * GSAP dependency is deliberately NOT adopted: this tree carries
 * no runtime motion library by design (Design Constitution: the
 * missing motion library is a decision, not a gap), and the
 * behaviour the face law needs is the spring, not the brand.
 *
 * Reduced motion: the spring lands on its target on the next
 * frame (spring.ts honours prefers-reduced-motion), so reduced
 * travellers get the content instantly, fully readable.
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { animateSpringValue, type BuiSpringHandle } from "@/components/boardui/spring";

export interface BuiEnterContentProps {
  children?: ReactNode;
  /** Rise distance in px before settling. */
  distance?: number;
  /** Fade in from opacity 0 alongside the rise. */
  animateOpacity?: boolean;
  /** Start delay in ms — the stagger step for cascades (70 ms is the house step). */
  delay?: number;
  /** When this changes, the entrance replays (a step branched, a pick landed). */
  enterKey?: string | number;
  className?: string;
  style?: CSSProperties;
}

export function BuiEnterContent({
  children,
  distance = 10,
  animateOpacity = true,
  delay = 0,
  enterKey,
  className = "",
  style
}: BuiEnterContentProps) {
  const [progress, setProgress] = useState(0);
  const [settled, setSettled] = useState(false);
  const handleRef = useRef<BuiSpringHandle | null>(null);

  useEffect(() => {
    // Runs on mount, and again only when enterKey changes (the deps
    // array) — an unchanged key across re-renders never replays it.
    setSettled(false);
    setProgress(0);
    let handle: BuiSpringHandle | null = null;
    const timer = window.setTimeout(() => {
      handle = animateSpringValue({
        from: 0,
        to: 1,
        restDelta: 0.002,
        restVelocity: 0.02,
        onFrame: (value) => setProgress(value),
        onRest: () => {
          setProgress(1);
          setSettled(true);
        }
      });
      handleRef.current = handle;
    }, Math.max(0, delay));
    return () => {
      window.clearTimeout(timer);
      handle?.cancel();
      if (handleRef.current === handle) handleRef.current = null;
    };
    // distance/animateOpacity are visual constants for a given mount;
    // the entrance is keyed on enterKey alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterKey]);

  const p = Math.min(1, Math.max(0, progress));
  const liveStyle: CSSProperties = settled
    ? {}
    : {
        transform: `translateY(${((1 - progress) * distance).toFixed(2)}px)`,
        opacity: animateOpacity ? p : 1
      };

  return (
    <div className={className} style={{ ...liveStyle, ...style }}>
      {children}
    </div>
  );
}

export default BuiEnterContent;
