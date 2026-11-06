/**
 * BoardUI Animated Icons — Roamly foundation (Animated-Icons pass,
 * 2026-11-04; owner micro-interaction set: "icons MOVE between
 * states, never swap pictures").
 *
 * Six state morphs, each built so the SAME elements travel between
 * the two states — paths retarget their `d`, groups rotate/scale
 * on the spring curve, strokes draw themselves in. Nothing here
 * crossfades between two different pictures and calls it a morph.
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
export function BuiDownloadIcon({
  state,
  className
}: {
  state: "idle" | "active" | "done";
  className?: string;
}) {
  const RING_C = 2 * Math.PI * 9; // r=9 → ≈56.5
  return (
    <SvgShell className={className}>
      <circle
        cx="12"
        cy="12"
        r="9"
        strokeDasharray={RING_C}
        strokeDashoffset={state === "idle" ? RING_C : 0}
        opacity={state === "idle" ? 0 : 1}
        style={{ transition: "stroke-dashoffset 700ms var(--bui-ease), opacity 200ms var(--bui-ease)" }}
      />
      <g
        opacity={state === "done" ? 0 : 1}
        style={{
          transform: state === "active" ? "translateY(2.5px)" : "translateY(0)",
          transition: "transform 320ms var(--bui-spring-ease), opacity 180ms var(--bui-ease)"
        }}
      >
        <path d="M12 3v10" />
        <path d="m6.5 10.5 5.5 5.5 5.5-5.5" />
      </g>
      <path
        d="M4 19h16"
        opacity={state === "idle" ? 1 : 0}
        style={{ transition: "opacity 200ms var(--bui-ease)" }}
      />
      <path
        d="m8 12.5 2.8 2.8L16 9.8"
        strokeDasharray={13}
        strokeDashoffset={state === "done" ? 0 : 13}
        style={{ transition: "stroke-dashoffset 320ms var(--bui-ease) 60ms" }}
      />
    </SvgShell>
  );
}

/* ------------------------------------------------------------------ */
/* Theme — the sun's rays rotate away and shrink as the crescent     */
/* draws itself in; the centre disc persists through both states.    */
/* ------------------------------------------------------------------ */
export function BuiThemeIcon({ dark, className }: { dark: boolean; className?: string }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <SvgShell className={className}>
      <g
        style={{
          transform: dark ? "rotate(50deg) scale(0.55)" : "rotate(0deg) scale(1)",
          transformOrigin: "12px 12px",
          opacity: dark ? 0 : 1,
          transition: "transform 420ms var(--bui-spring-ease), opacity 260ms var(--bui-ease)"
        }}
      >
        {rays.map((deg) => (
          <line key={deg} x1="12" y1="2.5" x2="12" y2="4.8" transform={`rotate(${deg} 12 12)`} />
        ))}
      </g>
      <circle
        cx="12"
        cy="12"
        r={dark ? 0.1 : 4}
        opacity={dark ? 0 : 1}
        style={{ transition: "opacity 200ms var(--bui-ease)" }}
      />
      <path
        d="M20 13.5A8.1 8.1 0 1 1 10.5 4a6.6 6.6 0 0 0 9.5 9.5Z"
        strokeDasharray={48}
        strokeDashoffset={dark ? 0 : 48}
        opacity={dark ? 1 : 0}
        style={{ transition: "stroke-dashoffset 460ms var(--bui-ease), opacity 160ms var(--bui-ease)" }}
      />
    </SvgShell>
  );
}

/* ------------------------------------------------------------------ */
/* Search / close — the magnifier's handle stretches into one arm    */
/* of the X while its twin (stacked invisibly on the handle) sweeps  */
/* into the other; the lens dissolves as they cross.                 */
/* ------------------------------------------------------------------ */
export function BuiSearchXIcon({ open, className }: { open: boolean; className?: string }) {
  const arm = { transition: "d 300ms var(--bui-spring-ease)" } as const;
  return (
    <SvgShell className={className}>
      <circle
        cx="11"
        cy="11"
        r="7"
        opacity={open ? 0 : 1}
        style={{
          transform: open ? "scale(0.55)" : "scale(1)",
          transformOrigin: "11px 11px",
          transition: "transform 300ms var(--bui-spring-ease), opacity 220ms var(--bui-ease)"
        }}
      />
      <path d={open ? "M11 11 L21 21" : "M13.5 13.5 L20.5 20.5"} style={arm} />
      <path d={open ? "M21 11 L11 21" : "M13.5 13.5 L20.5 20.5"} style={arm} />
    </SvgShell>
  );
}

/* ------------------------------------------------------------------ */
/* Send — the plane flies off on an arc; a new plane springs in      */
/* from the lower left (one element, one flight: the re-entry is     */
/* the spring-eased second half of the same keyframe run).           */
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
