/**
 * BoardUI spring — Roamly foundation motion physics (iPhone-Feel
 * pass, 2026-11-04; owner rules in ~/AGENTS.md "IPHONE FEEL — 6
 * INVISIBLE DETAILS").
 *
 * A hand-rolled damped-harmonic-oscillator integrator. Why not a
 * library: this tree's dependency set carries no spring/motion
 * package, and the branch's discipline is owned source with no
 * runtime dependency — a 100-line integrator is the whole need.
 * The physics is real, not a renamed ease: position and velocity
 * are integrated every frame (semi-implicit Euler, fixed 240 Hz
 * substeps, so the result is frame-rate independent), and every
 * animation is a spring toward a target that can be RETARGETED
 * mid-flight with its velocity intact — interruptibility is a
 * property of the model, not a feature bolted onto it.
 *
 * Default tuning is the owner's spec, and the numbers agree with
 * each other: damping ratio ζ = 0.8 gives a theoretical overshoot
 * of e^(−πζ/√(1−ζ²)) = 1.52% — the "~1.5% overshoot" of the rule —
 * fast first, a breath past the target, then settle. Stiffness
 * 260 (mass 1) puts the settle at roughly 300 ms, inside the
 * house's "everything under ~420 ms" craft rule.
 *
 * Reduced motion: when the traveller's system says reduce motion,
 * a spring does not animate at all — it lands on its target on the
 * next frame. Nothing essential anywhere depends on the travel.
 */
"use client";

import { useEffect, useRef, useState } from "react";

export interface BuiSpringParams {
  /** Spring stiffness k (mass-normalised). Higher = faster. */
  stiffness?: number;
  /** Damping ratio ζ. 0.8 = the owner's ~1.5% overshoot spec. */
  dampingRatio?: number;
  mass?: number;
  /** Settle when |value − target| <= this (caller's units). */
  restDelta?: number;
  /** …and |velocity| <= this (caller's units per second). */
  restVelocity?: number;
}

export const BUI_SPRING_DEFAULTS: Required<BuiSpringParams> = {
  stiffness: 260,
  dampingRatio: 0.8,
  mass: 1,
  restDelta: 0.05,
  restVelocity: 1
};

export function buiPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface BuiSpringHandle {
  /** Retarget mid-flight; velocity carries over unless given. */
  retarget: (to: number, velocityPerSec?: number) => void;
  /** Stop where it is; no rest callback fires after a cancel. */
  cancel: () => void;
  readonly value: number;
  readonly velocity: number;
}

interface SpringRunOptions extends BuiSpringParams {
  from: number;
  to: number;
  /** Initial velocity, caller's units per second. */
  velocity?: number;
  onFrame: (value: number, velocityPerSec: number) => void;
  onRest?: (value: number) => void;
}

/**
 * Animate one number toward a target on a real spring. Returns a
 * handle: retarget it (interrupt), cancel it, read it. The spring
 * owns a requestAnimationFrame loop only while it is moving.
 */
export function animateSpringValue(options: SpringRunOptions): BuiSpringHandle {
  const params: Required<BuiSpringParams> = { ...BUI_SPRING_DEFAULTS, ...stripUndefined(options) };
  const damping = 2 * params.dampingRatio * Math.sqrt(params.stiffness * params.mass);

  let value = options.from;
  let velocity = options.velocity ?? 0;
  let target = options.to;
  let raf = 0;
  let lastTime = 0;
  let cancelled = false;
  let resting = false;

  const handle: BuiSpringHandle = {
    retarget(to: number, velocityPerSec?: number) {
      if (cancelled) return;
      target = to;
      if (typeof velocityPerSec === "number") velocity = velocityPerSec;
      resting = false;
      if (!raf) {
        lastTime = performance.now();
        raf = requestAnimationFrame(step);
      }
    },
    cancel() {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    get value() {
      return value;
    },
    get velocity() {
      return velocity;
    }
  };

  function finish() {
    value = target;
    velocity = 0;
    resting = true;
    raf = 0;
    options.onFrame(value, 0);
    if (!cancelled) options.onRest?.(value);
  }

  function step(now: number) {
    raf = 0;
    if (cancelled) return;
    if (buiPrefersReducedMotion()) {
      finish();
      return;
    }
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05; // a backgrounded tab must not teleport the spring
    const substeps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / substeps;
    for (let i = 0; i < substeps; i += 1) {
      const accel = (-params.stiffness * (value - target) - damping * velocity) / params.mass;
      velocity += accel * h;
      value += velocity * h;
    }
    if (Math.abs(value - target) <= params.restDelta && Math.abs(velocity) <= params.restVelocity) {
      finish();
      return;
    }
    options.onFrame(value, velocity);
    raf = requestAnimationFrame(step);
  }

  if (buiPrefersReducedMotion() || (value === target && velocity === 0)) {
    // Land on the next frame so callers can store the handle first.
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!cancelled) finish();
    });
  } else {
    lastTime = performance.now();
    raf = requestAnimationFrame(step);
  }
  void resting;
  return handle;
}

function stripUndefined(options: SpringRunOptions): BuiSpringParams {
  const out: BuiSpringParams = {};
  if (options.stiffness !== undefined) out.stiffness = options.stiffness;
  if (options.dampingRatio !== undefined) out.dampingRatio = options.dampingRatio;
  if (options.mass !== undefined) out.mass = options.mass;
  if (options.restDelta !== undefined) out.restDelta = options.restDelta;
  if (options.restVelocity !== undefined) out.restVelocity = options.restVelocity;
  return out;
}

/**
 * React binding: a number that springs toward `target`. Retargets
 * (with velocity intact) whenever `target` changes — a control
 * tapped mid-travel reverses from wherever it currently is. The
 * handle lives for the component's whole life; `initial` sets the
 * first value when the first render must start away from target
 * (e.g. a tab pill arriving from the previously active tab).
 */
export function useSpringNumber(
  target: number,
  options: BuiSpringParams & { initial?: number } = {}
): { value: number; velocity: number } {
  const [state, setState] = useState(() => ({ value: options.initial ?? target, velocity: 0 }));
  const handleRef = useRef<BuiSpringHandle | null>(null);
  const paramsRef = useRef(options);
  paramsRef.current = options;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.retarget(target);
      return;
    }
    const start = stateRef.current;
    const handle = animateSpringValue({
      from: start.value,
      to: target,
      velocity: start.velocity,
      stiffness: paramsRef.current.stiffness,
      dampingRatio: paramsRef.current.dampingRatio,
      mass: paramsRef.current.mass,
      restDelta: paramsRef.current.restDelta,
      restVelocity: paramsRef.current.restVelocity,
      onFrame: (value, velocity) => setState({ value, velocity }),
      onRest: (value) => setState({ value, velocity: 0 })
    });
    handleRef.current = handle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(
    () => () => {
      handleRef.current?.cancel();
      handleRef.current = null;
    },
    []
  );

  return state;
}

/**
 * Rubber-band resistance (iPhone-feel rule 4): a pull of `pull` px
 * past an edge moves the surface only `pull·K / (pull + K)` px —
 * resistance grows the further you pull. With K = 151, a 200 px
 * pull stretches 86 px, the owner's figure. The curve is smooth
 * from the first pixel (no dead zone, no kink at the edge).
 */
export const RUBBER_BAND_K = 151;

export function rubberBand(pullPx: number, constant = RUBBER_BAND_K): number {
  if (pullPx <= 0) return 0;
  return (pullPx * constant) / (pullPx + constant);
}
