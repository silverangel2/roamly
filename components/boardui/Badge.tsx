/**
 * BoardUI Badge + Chip — Roamly port.
 *
 * Provenance: ported from BoardUI's `badge` (counter pills) and `chip`
 * (status/delta chips in bold and soft variants across the accent
 * palette) base components (BoardUI/boardui, MIT).
 *
 * Adaptations: BoardUI's accent palette mapped onto Roamly's token
 * tones (primary blue, success, warm orange, alt purple, danger,
 * neutral navy-slate). Plain spans — no behaviour, no new deps.
 */
import type { ReactNode } from "react";
import { cx } from "./cx";
import type { BuiTone } from "./tokens";

const softTone: Record<BuiTone, string> = {
  primary: "bg-csoft text-cnavy",
  navy: "bg-cnavy/10 text-cnavy",
  success: "bg-[#E5F6EE] text-[#0E7A4E]",
  warm: "bg-[#FFF0E6] text-[#B4501B]",
  alt: "bg-[#F0EAFB] text-[#5F3DB8]",
  danger: "bg-[#FDECEF] text-[#B92C44]",
  neutral: "bg-cbg text-cink"
};

const boldTone: Record<BuiTone, string> = {
  primary: "bg-cblue text-white",
  navy: "bg-cnavy text-white",
  success: "bg-cgreen text-white",
  warm: "bg-corange text-white",
  alt: "bg-cpurple text-white",
  danger: "bg-cred text-white",
  neutral: "bg-chead text-white"
};

export function BuiBadge({
  tone = "primary",
  bold = false,
  className,
  children
}: {
  tone?: BuiTone;
  bold?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.08em]",
        bold ? boldTone[tone] : softTone[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function BuiChip({
  tone = "neutral",
  bold = false,
  className,
  children
}: {
  tone?: BuiTone;
  bold?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold normal-case tracking-normal",
        bold ? boldTone[tone] : softTone[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
