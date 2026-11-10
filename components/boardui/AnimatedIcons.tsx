/**
 * BoardUI Animated Icons — Roamly foundation (Animated-Icons pass,
 * 2026-11-04; owner micro-interaction set: "icons MOVE between
 * states, never swap pictures").
 *
 * State morphs, each built so the SAME elements travel between
 * the two states — paths retarget their `d`, groups rotate/scale
 * on the spring curve, strokes draw themselves in. Nothing here
 * crossfades between two different pictures and calls it a morph.
 *
 * Batch 10 trim (2026-11-10): the set shipped six morphs; three
 * had no honest customer surface and were removed rather than
 * left as decoration — the download ring (no download control
 * anywhere carries an idle/active/done state), the theme morph
 * (the product is light-only; no theme toggle exists), and the
 * search/close morph (no search control toggles between search
 * and close — the finds search opens a panel, it is not an
 * icon toggle). What remains is exactly what real surfaces use:
 * send (TripShareActions), unlock (ActivateTripButton), and
 * play/pause (the home hero's rotation control, wired batch 10 —
 * it previously swapped two Lucide pictures, the precise habit
 * this file exists to replace). If a removed morph's surface
 * ever honestly arrives, the morph is rebuilt from the owner's
 * set-1 spec in ~/AGENTS.md, not resurrected from memory.
 *
 * Icon geometry is the Lucide set's (24×24, stroke currentColor,
 * round caps — the branch's adopted icon source), drawn as inline
 * SVG because this branch's dependency set carries no icon
 * package; the morph machinery is the point of the file, and it
 * is package-independent. Motion runs on the foundation's curves:
 * CSS state changes use --bui-spring-ease (ζ≈0.8's CSS shadow);
 * the unlock shackle is driven by the real JS spring at ζ=0.32,
 * whose theoretical overshoot is 34.6% — the reel's ~34%.
 * prefers-reduced-motion kills every travel (the foundation's
 * reduce blocks cover the CSS; the JS spring lands instantly).
 */
"use client";

import { useSpringNumber } from "./spring";
import { cx } from "./cx";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
} as const;

function SvgShell({
  className,
  children,
  label
}: {
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className={cx("h-5 w-5 shrink-0", className)}
      {...STROKE}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Play / pause — two filled paths whose `d` retargets: the pause    */
/* bars literally narrow and lean into the play triangle.            */
/* ------------------------------------------------------------------ */
export function BuiPlayPauseIcon({ playing, className }: { playing: boolean; className?: string }) {
  const dLeft = playing ? "M6 5 L13 8.5 L13 15.5 L6 19 Z" : "M6 5 L10 5 L10 19 L6 19 Z";
  const dRight = playing ? "M13 8.5 L20 12 L13 15.5 Z" : "M14 5 L18 5 L18 19 L14 19 Z";
  const morph = { transition: "d 280ms var(--bui-spring-ease)", fill: "currentColor", stroke: "none" } as const;
  return (
    <SvgShell className={className}>
      <path d={dLeft} style={morph} />
      <path d={dRight} style={morph} />
    </SvgShell>
  );
}

/* ------------------------------------------------------------------ */
/* Download — arrow sinks into the tray; a ring fills around it;     */
/* a tick draws itself when the download lands.                      */
/* ------------------------------------------------------------------ */
export function BuiSendIcon({ sent, className }: { sent: boolean; className?: string }) {
  return (
    <SvgShell className={cx(className)}>
      <g className={sent ? "bui-send-flight" : undefined}>
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4Z" />
      </g>
    </SvgShell>
  );
}

/* ------------------------------------------------------------------ */
/* Unlock — the shackle springs open around its right hinge on the   */
/* real JS spring at ζ = 0.32: it swings ~34% past its rest angle    */
/* before settling, the reel's overshoot, physically produced.       */
/* ------------------------------------------------------------------ */
export function BuiUnlockIcon({ open, className }: { open: boolean; className?: string }) {
  const { value: angle } = useSpringNumber(open ? -30 : 0, {
    stiffness: 320,
    dampingRatio: 0.32,
    restDelta: 0.05,
    restVelocity: 2
  });
  return (
    <SvgShell className={className}>
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "16px 11px" }}>
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </g>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" opacity={open ? 0.35 : 1} style={{ transition: "opacity 200ms var(--bui-ease)" }} />
    </SvgShell>
  );
}
