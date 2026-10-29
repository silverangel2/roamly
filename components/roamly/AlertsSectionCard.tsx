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

import { useState } from "react";

export type AlertsSectionRow = {
  id: string;
  title: string;
  body?: string | null;
  href?: string | null;
  icon: "document" | "weather" | "packing" | "departure" | "checkin" | "booking" | "update" | "generic";
};

function IconTile({ icon }: { icon: AlertsSectionRow["icon"] }) {
  const common = "grid h-10 w-10 shrink-0 place-items-center rounded-[10px]";
  const pathProps = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  } as const;
  switch (icon) {
    case "document":
      return (
        <span className={`${common} bg-[#E3F2FD] text-[#1565C0]`}>
          <svg {...pathProps} aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></svg>
        </span>
      );
    case "weather":
      return (
        <span className={`${common} bg-[#E3F2FD] text-[#1565C0]`}>
          <svg {...pathProps} aria-hidden="true"><path d="M17.5 19a4.5 4.5 0 0 0 .4-8.98A6 6 0 0 0 6.2 12.5 4.5 4.5 0 0 0 7 19h10.5z" /><path d="M12 22v-2" /></svg>
        </span>
      );
    case "packing":
      return (
        <span className={`${common} bg-[#E8F5E9] text-[#2E7D32]`}>
          <svg {...pathProps} aria-hidden="true"><path d="M6 7h12l1 13H5L6 7z" /><path d="M9 7a3 3 0 0 1 6 0M9 10v6M15 10v6" /></svg>
        </span>
      );
    case "departure":
      return (
        <span className={`${common} bg-[#E3F2FD] text-[#1565C0]`}>
          <svg {...pathProps} aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-5z" /></svg>
        </span>
      );
    case "checkin":
      return (
        <span className={`${common} bg-[#E3F2FD] text-[#1565C0]`}>
          <svg {...pathProps} aria-hidden="true"><path d="M3 21h18M5 21V8l7-5 7 5v13" /><path d="M9 21v-6h6v6" /></svg>
        </span>
      );
    case "booking":
      return (
        <span className={`${common} bg-[#E3F2FD] text-[#1565C0]`}>
          <svg {...pathProps} aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 10H2M6 15h4" /></svg>
        </span>
      );
    case "update":
      return (
        <span className={`${common} bg-[#E3F2FD] text-[#1565C0]`}>
          <svg {...pathProps} aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" /></svg>
        </span>
      );
    default:
      return (
        <span className={`${common} bg-cbg text-cgray}`}>
          <svg {...pathProps} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>
        </span>
      );
  }
}

const BADGE_TONES: Record<string, string> = {
  red: "bg-[#FFEBEE] text-[#C62828]",
  blue: "bg-[#E3F2FD] text-[#1565C0]",
  green: "bg-[#E8F5E9] text-[#2E7D32]"
};

export function AlertsSectionCard({
  title,
  badgeTone = "blue",
  rows,
  emptyText = null
}: {
  title: string;
  badgeTone?: "red" | "blue" | "green";
  rows: AlertsSectionRow[];
  /** Owner-10 item 9: when set, an empty section renders this honest
   *  empty state instead of vanishing (Travel updates only — other
   *  sections keep the old null-on-empty behavior). */
  emptyText?: string | null;
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
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          <h2 className="flex items-baseline gap-2 text-[20px] font-bold tracking-[-0.018em] text-chead">
            {title}
            <span
              title="0 in total"
              aria-label="0 in total"
              className={`rounded-full px-2 py-0.5 text-[13px] font-bold ${BADGE_TONES[badgeTone]}`}
            >
              0
            </span>
          </h2>
        </div>
        <p className="rounded-2xl bg-white px-4 py-3 text-[15px] font-normal leading-[1.45] text-cgray shadow-calm">
          {emptyText}
        </p>
      </section>
    );
  }
  const visible = expanded ? rows : rows.slice(0, 3);
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="flex items-baseline gap-2 text-[20px] font-bold tracking-[-0.018em] text-chead">
          {title}
          <span
            title={`${rows.length} in total`}
            aria-label={`${rows.length} in total`}
            className={`rounded-full px-2 py-0.5 text-[13px] font-bold ${BADGE_TONES[badgeTone]}`}
          >
            {rows.length}
          </span>
        </h2>
        {rows.length >= 1 ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="shrink-0 text-[15px] font-semibold text-cblue"
          >
            {expanded ? "See less" : rows.length > 3 ? `See all ${rows.length}` : "See all"}
          </button>
        ) : null}
      </div>
      <div className="divide-y divide-chair overflow-hidden rounded-2xl bg-white shadow-calm">
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
              <svg width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="#B7C1D2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                <path d="M1.5 1.5 6.5 6.5 1.5 11.5" />
              </svg>
            </>
          );
          return row.href ? (
            <a key={row.id} href={row.href} className="flex items-center gap-3 px-4 py-3">
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
