/**
 * BoardUI ClickSpark — a small burst of brand-blue line sparks on
 * touch-down, so a tap visibly lands (owner motion law: press
 * feedback at 0 ms; "like/save tap pops with a small burst —
 * without feedback people tap twice to be sure", Motion Set 1).
 *
 * PORTED from React Bits `ClickSpark` (DavidHDev/react-bits),
 * adapted subset: the line shape only, BoardUI token colour by
 * default, canvas burst engine and pointer handling carried over.
 * First BoardUI-layer use of React Bits — closes gap G1 of the
 * Design Constitution (approved component source since 2026-10-31,
 * previously zero adoption).
 *
 * LICENSE — React Bits is MIT + Commons Clause License Condition
 * v1.0 (verified from the repo's LICENSE.md, 2026-11-08):
 *   Copyright (c) 2026 David Haz
 *   "Permission is hereby granted ... to use, copy, modify, merge,
 *   publish, and distribute the Software AS PART OF AN APPLICATION,
 *   WEBSITE, OR PRODUCT ... You may use this Software, including
 *   for any commercial purpose, so long as you do not sell,
 *   sublicense, or redistribute the components themselves."
 * Roamly uses the components inside its own product and never
 * sells or redistributes them — the permitted use, with this
 * notice carried in the file as the license requires.
 * Full text: https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md
 *
 * Reduced motion: with prefers-reduced-motion the burst collapses
 * to a short, static fade (upstream behaviour) — nothing essential
 * ever rides on the sparks; they are feedback, not information.
 */
"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties, type ReactNode } from "react";

import { buiPrimitives } from "@/components/boardui/tokens";

export type BuiClickSparkEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring";

export interface BuiClickSparkProps {
  /** Spark colour(s). Defaults to the Roamly brand blue token. */
  sparkColor?: string | string[];
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  sparkWidth?: number;
  duration?: number;
  easing?: BuiClickSparkEasing;
  extraScale?: number;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export interface BuiClickSparkHandle {
  spark: (x?: number, y?: number) => void;
}

interface SparkSettings {
  colors: string[];
  size: number;
  radius: number;
  count: number;
  width: number;
  duration: number;
  ease: (t: number) => number;
  disabled: boolean;
}

interface Spark {
  angle: number;
  reach: number;
  scale: number;
  life: number;
  color: string;
}

interface Burst {
  x: number;
  y: number;
  start: number;
  sparks: Spark[];
  settings: SparkSettings;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  ratio: number;
  left: number;
  top: number;
}

const EASINGS: Record<BuiClickSparkEasing, (t: number) => number> = {
  linear: (t) => t,
  "ease-in": (t) => t * t,
  "ease-out": (t) => 1 - Math.pow(1 - t, 3),
  "ease-in-out": (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  spring: (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2)
};

const MAX_BURSTS = 32;
const REDUCED_MS = 320;
const RANDOMNESS = 0.2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const toColors = (value: string | string[]): string[] => {
  const list = (Array.isArray(value) ? value : [value]).filter(Boolean);
  return list.length ? list : [buiPrimitives.blue];
};

const BuiClickSpark = forwardRef<BuiClickSparkHandle, BuiClickSparkProps>(
  (
    {
      sparkColor = buiPrimitives.blue,
      sparkSize = 10,
      sparkRadius = 22,
      sparkCount = 8,
      sparkWidth = 2,
      duration = 420,
      easing = "ease-out",
      extraScale = 1,
      disabled = false,
      className = "",
      style,
      children
    },
    ref
  ) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLSpanElement>(null);
    const engineRef = useRef<BuiClickSparkHandle | null>(null);
    const settings: SparkSettings = {
      colors: toColors(sparkColor),
      size: Math.max(0, sparkSize),
      radius: Math.max(0, sparkRadius) * Math.max(0, extraScale),
      count: clamp(Math.round(sparkCount), 1, 64),
      width: Math.max(0.5, sparkWidth),
      duration: Math.max(60, duration),
      ease: EASINGS[easing] ?? EASINGS["ease-out"],
      disabled
    };
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    useEffect(() => {
      const root = rootRef.current;
      const layer = layerRef.current;
      if (!root || !layer) return;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const bursts: Burst[] = [];
      let raf = 0;
      let lastPress = { time: -1e9, x: 0, y: 0 };

      const drawSpark = (ctx: CanvasRenderingContext2D, burst: Burst, spark: Spark, elapsed: number) => {
        const s = burst.settings;
        const life = reduced ? REDUCED_MS : s.duration * spark.life;
        const p = elapsed / life;
        if (p >= 1) return false;
        const e = reduced ? 0.55 : s.ease(clamp(p, 0, 1));
        const distance = s.radius * spark.reach * e;
        const width = s.width * spark.scale;
        const fade = reduced ? 1 - p : 1 - smoothstep(0.55, 1, p);
        if (fade <= 0) return true;
        const length = s.size * spark.scale * (reduced ? 0.5 : Math.pow(1 - p, 1.6));
        const x1 = burst.x + Math.cos(spark.angle) * distance;
        const y1 = burst.y + Math.sin(spark.angle) * distance;
        const x2 = burst.x + Math.cos(spark.angle) * (distance + Math.max(0.01, length));
        const y2 = burst.y + Math.sin(spark.angle) * (distance + Math.max(0.01, length));
        ctx.strokeStyle = spark.color;
        ctx.lineCap = "round";
        ctx.globalAlpha = fade;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return true;
      };

      const remove = (burst: Burst) => {
        burst.canvas.remove();
        const index = bursts.indexOf(burst);
        if (index >= 0) bursts.splice(index, 1);
      };

      const frame = (now: number) => {
        raf = 0;
        for (const burst of [...bursts]) {
          const elapsed = now - burst.start;
          const ctx = burst.ctx;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, burst.canvas.width, burst.canvas.height);
          ctx.setTransform(burst.ratio, 0, 0, burst.ratio, -burst.left * burst.ratio, -burst.top * burst.ratio);
          let alive = false;
          for (const spark of burst.sparks) {
            if (drawSpark(ctx, burst, spark, elapsed)) alive = true;
          }
          ctx.globalAlpha = 1;
          if (!alive) remove(burst);
        }
        if (bursts.length) raf = requestAnimationFrame(frame);
      };

      const spawn = (clientX: number, clientY: number) => {
        const s = settingsRef.current;
        if (s.disabled) return;
        const rect = root.getBoundingClientRect();
        const offset = Math.floor(Math.random() * s.colors.length);
        const step = (Math.PI * 2) / s.count;
        const sparks: Spark[] = Array.from({ length: s.count }, (_, i) => {
          const jitter = (Math.random() - 0.5) * RANDOMNESS;
          return {
            angle: step * i + jitter * step * 0.9,
            reach: 1 + (Math.random() - 0.5) * 0.7 * RANDOMNESS,
            scale: 1 + (Math.random() - 0.5) * 0.8 * RANDOMNESS,
            life: 1 + (Math.random() - 0.5) * 0.5 * RANDOMNESS,
            color: s.colors[(i + offset) % s.colors.length]
          };
        });
        const reach = s.radius * (1 + 0.35 * RANDOMNESS) + s.size * (1 + 0.4 * RANDOMNESS) + s.width * 2 + 6;
        const box = {
          left: Math.max(clientX - reach, 0),
          top: Math.max(clientY - reach, 0),
          right: Math.min(clientX + reach, window.innerWidth),
          bottom: Math.min(clientY + reach, window.innerHeight)
        };
        if (box.right - box.left < 1 || box.bottom - box.top < 1) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil((box.right - box.left) * ratio);
        canvas.height = Math.ceil((box.bottom - box.top) * ratio);
        Object.assign(canvas.style, {
          position: "absolute",
          left: `${box.left - rect.left}px`,
          top: `${box.top - rect.top}px`,
          width: `${box.right - box.left}px`,
          height: `${box.bottom - box.top}px`,
          display: "block",
          pointerEvents: "none"
        });
        canvas.setAttribute("aria-hidden", "true");
        layer.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          canvas.remove();
          return;
        }
        bursts.push({ x: clientX, y: clientY, start: performance.now(), sparks, settings: { ...s }, canvas, ctx, ratio, left: box.left, top: box.top });
        while (bursts.length > MAX_BURSTS) remove(bursts[0]);
        if (!raf) raf = requestAnimationFrame(frame);
      };

      const onPointerDown = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        lastPress = { time: performance.now(), x: event.clientX, y: event.clientY };
        spawn(event.clientX, event.clientY);
      };

      const onClick = (event: MouseEvent) => {
        if ("pointerType" in event && (event as MouseEvent & { pointerType?: string }).pointerType === "mouse") return;
        if (event.detail === 0) {
          // Keyboard activation: burst from the tapped control's centre.
          const target = event.target instanceof Element ? event.target : root;
          const rect = target.getBoundingClientRect();
          spawn(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return;
        }
        const recent =
          performance.now() - lastPress.time < 700 &&
          Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) < 12;
        if (!recent) spawn(event.clientX, event.clientY);
      };

      root.addEventListener("pointerdown", onPointerDown);
      root.addEventListener("click", onClick);

      engineRef.current = {
        spark: (x?: number, y?: number) => {
          const rect = root.getBoundingClientRect();
          spawn(rect.left + (x ?? rect.width / 2), rect.top + (y ?? rect.height / 2));
        }
      };

      return () => {
        cancelAnimationFrame(raf);
        root.removeEventListener("pointerdown", onPointerDown);
        root.removeEventListener("click", onClick);
        for (const burst of [...bursts]) remove(burst);
        engineRef.current = null;
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        spark: (x?: number, y?: number) => engineRef.current?.spark(x, y)
      }),
      []
    );

    return (
      <div ref={rootRef} className={className} style={{ position: "relative", isolation: "isolate", ...style }}>
        {children}
        <span
          ref={layerRef}
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, zIndex: 1, overflow: "visible", pointerEvents: "none" }}
        />
      </div>
    );
  }
);

BuiClickSpark.displayName = "BuiClickSpark";

export { BuiClickSpark };
export default BuiClickSpark;
