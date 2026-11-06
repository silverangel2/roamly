/**
 * BoardUI Notice — Roamly foundation pattern.
 *
 * Purpose (owner vibe-tells checklist #4, 2026-11-03): errors and
 * notices are HUMAN messages — plain words, what happened, and the
 * next step — never raw error text, never silence. This is the one
 * pattern every surface uses to talk to the traveller: checkout
 * returns, form problems, confirmations. (The Jakob round's A5
 * cancelled-checkout banner is the same pattern in the Nov 5 tree;
 * this is its BoardUI-foundation form for the re-base.)
 *
 * Craft follows BoardUI's notification/toast family (BoardUI/boardui,
 * MIT): tinted surface, hairline edge, icon + title + body + one
 * clear action. Values are Roamly tokens; no black.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

export type BuiNoticeTone = "error" | "info" | "success";

const toneClasses: Record<BuiNoticeTone, string> = {
  error: "border-cred/40 bg-cred/10",
  info: "border-chair bg-csoft",
  success: "border-cgreen/40 bg-cgreen/10"
};

const dotClasses: Record<BuiNoticeTone, string> = {
  error: "bg-cred",
  info: "bg-cblue",
  success: "bg-cgreen"
};

export interface BuiNoticeProps {
  tone?: BuiNoticeTone;
  /** Plain-words headline: what happened, in the traveller's words. */
  title: string;
  /** The explanation + the next step. Never a raw error string. */
  children?: ReactNode;
  /** One clear next step, when there is one. */
  action?: { label: string; href: string };
  className?: string;
}

export function BuiNotice({ tone = "info", title, children, action, className }: BuiNoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("bui-enter flex items-start gap-3 rounded-bui-card border p-4 text-left", toneClasses[tone], className)}
    >
      <span aria-hidden="true" className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", dotClasses[tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-chead">{title}</p>
        {children ? <div className="mt-1 text-sm leading-6 text-cink">{children}</div> : null}
        {action ? (
          <Link
            href={action.href}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-cblue underline decoration-cblue/40 underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
