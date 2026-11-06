/**
 * BoardUI Card + Skeleton — Roamly port.
 *
 * Provenance: card craft ported from BoardUI's card-family components
 * (checkbox-card / radio-card / stat-cards, BoardUI/boardui, MIT) —
 * the shared recipe: generous radius, hairline border, layered soft
 * shadow, hover lift on interactive cards. Skeleton ported from
 * BoardUI's `skeleton` (content-shaped placeholders with a layered
 * light sheen that blur content in once loaded).
 *
 * Adaptations: Roamly token surface (white card on #F2F6FC ground,
 * #DCE5F0 hairline), house easing, shimmer via the `.bui-shimmer`
 * primitive in app/globals.css (navy-tinted sheen, never black),
 * reduced-motion safe.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export function BuiCard({
  interactive = false,
  className,
  children,
  ...rest
}: {
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div
      className={cx(
        "bui-squircle rounded-bui-card border border-chair bg-white shadow-bui-card",
        interactive && "bui-lift bui-press bui-tap",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function BuiSkeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("bui-shimmer rounded-bui-card bg-csoft", className)} />;
}
