/**
 * BoardUI Accordion — Roamly port (Design Constitution gap G2, closed
 * 2026-11-09).
 *
 * The one disclosure primitive for Roamly surfaces: a header button
 * (title + optional meta + chevron), a panel that GROWS open while
 * the rows below slide to make room — never a jump, never the raw
 * browser <details> triangle. Motion follows the owner's Motion
 * Set 3 accordion rule: the chevron flips 180°, the panel grows on
 * the house ease (the same curve bui-press rides, --bui-ease), and
 * the reduced-motion off-switch in app/globals.css kills the
 * transition entirely (content simply appears, fully readable).
 *
 * Craft follows BoardUI's card family (BoardUI/boardui, MIT):
 * hairline edges, bui-squircle corners, Roamly tokens — ink is the
 * deep navy-slate, never black.
 *
 * Client component: open state is local to the section. Content
 * stays mounted while closed (grid 0fr + overflow hidden), so
 * nested controls keep their state and server-rendered content is
 * present in the first paint exactly as the old <details> content
 * was.
 *
 * Controlled mode (additive, 2026-11-09, batch 5): pass `open` +
 * `onOpenChange` when the owner must drive the state itself — e.g.
 * a disclosure whose default follows a media query (the finds
 * rental disclosure: open on desktop, closed on phones). With no
 * `open` prop the accordion is uncontrolled, exactly as before.
 */
"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";

export function BuiAccordion({
  title,
  meta,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
  className,
  buttonClassName,
  panelClassName
}: {
  /** Header label — sentence case, plain words (the face law). */
  title: ReactNode;
  /** Optional quiet content at the header's right edge, before the chevron. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state; omit for the uncontrolled default. */
  open?: boolean;
  /** Fires with the next open state on header tap (controlled mode). */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const panelId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (openProp === undefined) setInternalOpen((value) => !value);
          onOpenChange?.(!open);
        }}
        className={cx(
          "bui-press bui-tap flex min-h-11 w-full items-center gap-2 text-left",
          buttonClassName
        )}
      >
        <span className="min-w-0 flex-1">{title}</span>
        {meta ?? null}
        <ChevronDown
          aria-hidden="true"
          size={18}
          strokeWidth={2}
          className={cx(
            "bui-accordion-chevron shrink-0 text-cchev transition-transform duration-300",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        id={panelId}
        aria-hidden={!open}
        className={cx(
          "bui-accordion-panel grid transition-[grid-template-rows] duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          panelClassName
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
