/**
 * BoardUI FlipCard — Roamly foundation primitive (Smooth-Details
 * pass, 2026-11-04; micro-interaction set: "card flip — 180° turn
 * lifting ~8% halfway, place card → details").
 *
 * A two-faced card on the foundation spring (spring.ts): the turn
 * is a spring toward 0° or 180°, so a tap MID-FLIP retargets it
 * from its current angle with its velocity intact — it reverses
 * from wherever it is, never completing a turn the traveller has
 * already changed their mind about (iPhone-feel rule 5,
 * interruptible). Halfway through the turn the card lifts ~8%
 * (scale follows the sine of the angle), the way a physical card
 * rises as it comes over.
 *
 * The whole card is one button (aria-pressed carries the state);
 * faces are presentational content supplied by the adopter —
 * links/buttons inside a face would nest interactive elements, so
 * adopters keep faces read-only and put actions outside the flip.
 * The adopter sets the height (className, e.g. h-56): both faces
 * fill it absolutely. Reduced motion: the spring lands instantly.
 */
"use client";

import { useState, type ReactNode } from "react";
import { useSpringNumber } from "./spring";
import { cx } from "./cx";

export function BuiFlipCard({
  front,
  back,
  label,
  className,
  faceClassName
}: {
  front: ReactNode;
  back: ReactNode;
  /** Accessible name for the flip control (names the card). */
  label: string;
  /** Sizing — the adopter owns the height (faces fill the card). */
  className?: string;
  faceClassName?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const { value: angle } = useSpringNumber(flipped ? 180 : 0, {
    stiffness: 300,
    dampingRatio: 0.8,
    restDelta: 0.05,
    restVelocity: 2
  });
  const lift = 1 + 0.08 * Math.sin((Math.min(180, Math.max(0, angle)) * Math.PI) / 180);

  return (
    <button
      type="button"
      aria-pressed={flipped}
      aria-label={label}
      onClick={() => setFlipped((current) => !current)}
      className={cx("bui-tap relative block w-full text-left [perspective:1200px]", className)}
    >
      <span
        className="relative block h-full w-full [transform-style:preserve-3d]"
        style={{ transform: `rotateY(${angle}deg) scale(${lift})` }}
      >
        <span
          aria-hidden={flipped}
          className={cx("absolute inset-0 block overflow-hidden [backface-visibility:hidden]", faceClassName)}
        >
          {front}
        </span>
        <span
          aria-hidden={!flipped}
          className={cx("absolute inset-0 block overflow-hidden [backface-visibility:hidden]", faceClassName)}
          style={{ transform: "rotateY(180deg)" }}
        >
          {back}
        </span>
      </span>
    </button>
  );
}
