"use client";

/*
 * AlertsSectionCard — one composite Alerts section: title + count badge
 * + "See all" toggle + icon-tile rows. Structure matches the composite
 * (Action required / Upcoming / Travel updates); every row is real data
 * passed in by the server page — this component invents no rows, times,
 * or destinations. Collapsed it shows the first three rows; "See all"
 * expands to the full real list (and back to "See less").
 * PICTURE 1 (owner picture): "See all" shows on EVERY section, even
 * one with fewer than three rows, and every row carries a chevron —
 * so the toggle renders whenever rows exist and the chevron renders
 * on every row (rows without a destination stay non-navigating divs;
 * the chevron is the picture's row affordance, not a link promise).
 */

import { useState, type CSSProperties } from "react";
import { Building, ChevronRight, Cloud, CreditCard, FileText, Mail, MapPin, Send, ShoppingBag } from "lucide-react";
import { BuiBadge } from "@/components/boardui/Badge";
import type { BuiTone } from "@/components/boardui/tokens";

export type AlertsSectionRow = {
  id: string;
  title: string;
  body?: string | null;
  href?: string | null;
  icon: "document" | "weather" | "packing" | "departure" | "checkin" | "booking" | "update" | "generic";
};

function IconTile({ icon }: { icon: AlertsSectionRow["icon"] }) {
  const common = "grid h-10 w-10 shrink-0 place-items-center rounded-[10px]";
  const p = { size: 20, strokeWidth: 2, "aria-hidden": true } as const;
  switch (icon) {
    case "document":
      return (
        <span className={`${common} bg-csoft text-cblue`}>
          <FileText {...p} />
        </span>
      );
    case "weather":
      return (
        <span className={`${common} bg-csoft text-cblue`}>
          <Cloud {...p} />
        </span>
      );
    case "packing":
      return (
        <span className={`${common} bg-[#E5F6EE] text-[#0E7A4E]`}>
          <ShoppingBag {...p} />
        </span>
      );
    case "departure":
      return (
        <span className={`${common} bg-csoft text-cblue`}>
          <Send {...p} />
        </span>
      );
    case "checkin":
      return (
        <span className={`${common} bg-csoft text-cblue`}>
          <Building {...p} />
        </span>
      );
    case "booking":
      return (
        <span className={`${common} bg-csoft text-cblue`}>
          <CreditCard {...p} />
        </span>
      );
    case "update":
      return (
        <span className={`${common} bg-csoft text-cblue`}>
          <Mail {...p} />
        </span>
      );
    default:
      return (
        <span className={`${common} bg-cbg text-cgray`}>
          {/* Audit fix: this default glyph was an exclamation mark in a circle, so every ordinary planned activity rendered with a warning-style icon and no label anywhere explaining it. The default is now a neutral place pin. */}
          <MapPin {...p} />
        </span>
      );
  }
}

const BADGE_TONES: Record<string, BuiTone> = {
  red: "danger",
  blue: "primary",
  green: "success"
};

export function AlertsSectionCard({
  title,
  badgeTone = "blue",
  rows,
  emptyText = null,
  delayMs = 0
}: {
  title: string;
  badgeTone?: "red" | "blue" | "green";
  rows: AlertsSectionRow[];
  /** Owner-10 item 9: when set, an empty section renders this honest
   *  empty state instead of vanishing (Travel updates only — other
   *  sections keep the old null-on-empty behavior). */
  emptyText?: string | null;
  /** BoardUI staggered entrance offset (presentation only). */
  delayMs?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // Owner-10 item 9: the badge is a TOTAL, not a shown-count — it is
  // labeled as one, and the collapsed toggle reads "See all N" when
  // the section holds more than the 3 collapsed rows. That is the
  // honest fix for the 20-vs-2 mismatch: the badge never pretended
  // to be the visible row count again.
  if (!rows.length) {
    if (!emptyText) return null;
    return (
      <section className="bui-enter" style={{ "--bui-delay": `${delayMs}ms` } as CSSProperties}>
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          <h2 className="flex items-baseline gap-2 text-[20px] font-bold tracking-[-0.018em] text-chead">
            {title}
            <BuiBadge tone={BADGE_TONES[badgeTone]} className="bui-display-number">
              <span title="0 in total" aria-label="0 in total">0</span>
            </BuiBadge>
          </h2>
        </div>
        <p className="rounded-bui-card border border-chair bg-white px-4 py-3 text-[15px] font-normal leading-[1.45] text-cgray shadow-bui-card">
          {emptyText}
        </p>
      </section>
    );
  }
  const visible = expanded ? rows : rows.slice(0, 3);
  return (
    <section className="bui-enter" style={{ "--bui-delay": `${delayMs}ms` } as CSSProperties}>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="flex items-baseline gap-2 text-[20px] font-bold tracking-[-0.018em] text-chead">
          {title}
          <BuiBadge tone={BADGE_TONES[badgeTone]} className="bui-display-number">
            <span title={`${rows.length} in total`} aria-label={`${rows.length} in total`}>{rows.length}</span>
          </BuiBadge>
        </h2>
        {rows.length >= 1 ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="bui-press bui-touch inline-flex shrink-0 items-center px-1 text-[15px] font-semibold text-cblue"
          >
            {expanded ? "See less" : rows.length > 3 ? `See all ${rows.length}` : "See all"}
          </button>
        ) : null}
      </div>
      <div className="divide-y divide-chair overflow-hidden rounded-bui-card border border-chair bg-white shadow-bui-card">
        {visible.map((row) => {
          const inner = (
            <>
              <IconTile icon={row.icon} />
              <span className="min-w-0 flex-1">
                {/* Owner-10 item 10: row titles wrap instead of
                    truncating — a long event title must read in
                    full at 390px, not hide behind an ellipsis. */}
                <span className="block break-words text-[17px] font-semibold leading-[1.3] text-chead">{row.title}</span>
                {row.body ? (
                  <span className="mt-0.5 block break-words text-[15px] font-normal leading-[1.4] text-cgray">{row.body}</span>
                ) : null}
              </span>
              <ChevronRight size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[#B7C1D2]" />
            </>
          );
          return row.href ? (
            <a key={row.id} href={row.href} className="bui-press bui-touch flex items-center gap-3 px-4 py-3">
              {inner}
            </a>
          ) : (
            <div key={row.id} className="flex items-center gap-3 px-4 py-3">
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
