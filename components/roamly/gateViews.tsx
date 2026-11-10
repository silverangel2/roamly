/*
 * Entry-gate presentational views (Phase 6). Pure props → markup, no
 * data fetching: EntryGate.tsx owns the state machine and platform
 * evidence; these views render it. Copy is the owner-accepted shadow
 * copy (build2-entry-gates renders, 2026-10-21) — the words are part
 * of the acceptance, not decoration.
 *
 * Scale law: the persistent banner is exactly 46px (owner-accepted
 * measurement); sheets are bottom sheets that fit one 390×844 screen.
 */

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiButton } from "@/components/boardui/Button";
import { BuiSheet } from "@/components/boardui/Sheet";
import Image from "next/image";
import {
  ALERTS_BANNER_LINE,
  EMAIL_REFUSAL_MESSAGE,
  INSTALL_BANNER_LINE
} from "@/lib/roamly/gateMachine";

export const GATE_LOGO_SRC = "/icon-512.png";

function SheetShell(props: { children: ReactNode; measure?: string }) {
  // Container Rules pass (2026-11-03): the gate sheets ride the shared
  // BuiSheet primitive — the identical bottom sheet on phones; on
  // desktop the sheet becomes the rule-4 side drawer (40vw, 320px
  // floor) with the page readable beside it. Gates stay
  // non-dismissible: they close only through their own Later / Not
  // now controls, exactly as before (dismissible={false} — no scrim
  // tap, no new gesture). Copy, order and the phone rendering are
  // untouched.
  return (
    <BuiSheet measure={props.measure} dismissible={false} className="px-5 pb-[26px] pt-[18px]">
      {props.children}
    </BuiSheet>
  );
}

function BrandRow(props: { step: string }) {
  return (
    <div className="flex items-center gap-[9px]">
      <Image src={GATE_LOGO_SRC} alt="Roamly logo" width={38} height={38} className="h-[38px] w-[38px] rounded-[10px]" />
      <span className="text-[17px] font-extrabold text-cnavy">Roamly</span>
      <BuiBadge tone="warm" className="ml-auto">
        {props.step}
      </BuiBadge>
    </div>
  );
}

function SheetTitle(props: { children: ReactNode }) {
  return <h2 className="mb-[7px] mt-[13px] text-[21.5px] font-extrabold leading-tight tracking-[-0.01em] text-chead">{props.children}</h2>;
}

function SheetReason(props: { children: ReactNode }) {
  return <p className="text-[14.5px] leading-[1.45] text-cink">{props.children}</p>;
}

function PrimaryButton(props: { children: ReactNode; onClick: () => void }) {
  return (
    <BuiButton type="button" onClick={props.onClick} className="mt-4 w-full text-base">
      {props.children}
    </BuiButton>
  );
}

function LaterButton(props: { onClick: () => void }) {
  return (
    <BuiButton type="button" variant="ghost" onClick={props.onClick} className="mt-[6px] w-full">
      Later
    </BuiButton>
  );
}

function SheetMicro(props: { children: ReactNode }) {
  return <p className="mt-[7px] text-center text-[12px] leading-[1.4] text-cgray2">{props.children}</p>;
}

/* ------------------------------------------------------------------ */
/* Install sheet (PROMPT / GUIDED)                                     */
/* ------------------------------------------------------------------ */

export function InstallSheetView(props: {
  guided: boolean;
  guidedKind: "native-prompt" | "numbered-steps" | "browser-steps" | null;
  onInstall: () => void;
  onLater: () => void;
  onSelfReportInstalled: () => void;
}) {
  return (
    <SheetShell measure="install-sheet">
      <BrandRow step="STEP 1 OF 2" />
      <SheetTitle>Put Roamly on your phone</SheetTitle>
      <SheetReason>
        Your trip alerts can only reach this phone once Roamly is installed on it —{" "}
        <b className="text-chead">that&apos;s a phone rule, not ours.</b> Installing takes a few
        seconds, and your itinerary continues right after.
      </SheetReason>
      {props.guided ? (
        <div className="mt-[13px] rounded-bui-card border border-chair bg-cbg px-[13px] py-[11px] shadow-bui-card">
          {props.guidedKind === "numbered-steps" ? (
            <ol className="list-none text-[13.5px] leading-[1.5] text-cink">
              <li><b className="text-chead">1.</b> Tap the Share icon in your browser.</li>
              <li><b className="text-chead">2.</b> Scroll and tap <b className="text-chead">Add to Home Screen</b>.</li>
              <li><b className="text-chead">3.</b> Tap <b className="text-chead">Add</b>, then open Roamly from your Home Screen.</li>
            </ol>
          ) : props.guidedKind === "native-prompt" ? (
            <p className="text-[13.5px] leading-[1.5] text-cink">
              Use your browser&apos;s install prompt to add Roamly to your Home Screen, then open it
              from that icon.
            </p>
          ) : (
            <p className="text-[13.5px] leading-[1.5] text-cink">
              In your browser menu, choose <b className="text-chead">Install app</b> or{" "}
              <b className="text-chead">Add to Home Screen</b>, then open Roamly from that icon.
            </p>
          )}
          <button
            type="button"
            onClick={props.onSelfReportInstalled}
            className="bui-press bui-touch mt-2 inline-flex items-center text-[13px] font-semibold text-cblue"
          >
            I&apos;ve installed it — check again
          </button>
        </div>
      ) : (
        <PrimaryButton onClick={props.onInstall}>Install Roamly</PrimaryButton>
      )}
      <LaterButton onClick={props.onLater} />
      <SheetMicro>Later keeps a small reminder at the top of every screen until Roamly is installed.</SheetMicro>
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ */
/* Alerts ask sheet (NOTIFY_ASK)                                       */
/* ------------------------------------------------------------------ */

export function AlertsAskSheetView(props: { onEnable: () => void; onLater: () => void }) {
  return (
    <SheetShell measure="alerts-ask-sheet">
      <BrandRow step="STEP 2 OF 2" />
      <SheetTitle>Turn on trip alerts</SheetTitle>
      <SheetReason>
        Roamly is installed on this phone. One thing left before it can look after you: leave-by
        times, delays and changes reach you as alerts — and alerts are required, so this trip
        can&apos;t continue until they&apos;re on.
      </SheetReason>
      <PrimaryButton onClick={props.onEnable}>Turn on alerts</PrimaryButton>
      <LaterButton onClick={props.onLater} />
      <SheetMicro>Later keeps a small reminder at the top of every screen until alerts are on.</SheetMicro>
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ */
/* Alerts denied sheet (NOTIFY_DENIED / GUIDED_ENABLE) — blocked,      */
/* guided-enable path only. There is no way around, only through.      */
/* ------------------------------------------------------------------ */

export function AlertsDeniedSheetView(props: {
  settingsPath: string;
  onCheckAgain: () => void;
  onLater: () => void;
}) {
  return (
    <SheetShell measure="alerts-denied-sheet">
      <BrandRow step="STEP 2 OF 2" />
      <SheetTitle>Trip alerts are off</SheetTitle>
      <SheetReason>
        Your companion can only look after you if it can reach you — leave-by times, delays and
        changes arrive as alerts. Alerts are required, so this trip can&apos;t continue until
        they&apos;re on.
      </SheetReason>
      <div className="mt-[13px] rounded-bui-card border border-chair bg-cbg px-[13px] py-[11px] shadow-bui-card">
        <p className="text-[12px] font-bold tracking-[0.03em] text-cblue">TURN THEM ON — TAKES TEN SECONDS</p>
        <p className="mt-[3px] text-[13.5px] leading-[1.45] text-cink">
          <b className="text-chead">{props.settingsPath}</b>. Then come back here — Roamly
          checks again the moment you return.
        </p>
      </div>
      <PrimaryButton onClick={props.onCheckAgain}>Check again</PrimaryButton>
      <LaterButton onClick={props.onLater} />
      <SheetMicro>Later keeps a small reminder at the top of every screen until alerts are on.</SheetMicro>
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ */
/* The 46px persistent banner (MINIMIZED)                              */
/* ------------------------------------------------------------------ */

export function GateBannerView(props: {
  line: string;
  actionLabel: string;
  onTap: () => void;
}) {
  const subline =
    props.line === ALERTS_BANNER_LINE ? "Leave-by times and changes arrive as alerts." : "Trip alerts need the app on this phone.";
  return (
    <div className="fixed inset-x-3 top-2 z-50">
      <button
        type="button"
        data-measure="gate-banner"
        onClick={props.onTap}
        className="bui-press flex h-[46px] w-full items-center gap-[9px] rounded-[12px] bg-cnavy py-[9px] pl-[11px] pr-[10px] text-left text-white shadow-[0_5px_16px_rgba(7,30,85,0.20)]"
      >
        <Image src={GATE_LOGO_SRC} alt="" width={23} height={23} className="h-[23px] w-[23px] flex-none rounded-[6px] bg-white p-[2px]" />
        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-tight">
          {props.line}
          <span className="block truncate text-[11px] font-medium text-white/70">{subline}</span>
        </span>
        <span className="flex-none whitespace-nowrap rounded-[8px] bg-white px-[11px] py-[7px] text-[12.5px] font-bold text-cnavy">
          {props.actionLabel}
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Connect Gmail sheet (the ready card's Gmail step, expanded)         */
/* ------------------------------------------------------------------ */

export function GmailAskSheetView(props: { onConnect: () => void; onNotNow: () => void }) {
  return (
    <SheetShell measure="gmail-ask-sheet">
      <div className="flex items-center gap-[9px]">
        <Image src={GATE_LOGO_SRC} alt="Roamly logo" width={38} height={38} className="h-[38px] w-[38px] rounded-[10px]" />
        <span className="text-[17px] font-extrabold text-cnavy">Roamly</span>
        <BuiBadge tone="warm" className="ml-auto">
          CONNECT GMAIL
        </BuiBadge>
      </div>
      <SheetTitle>Keep this trip matched to your bookings</SheetTitle>
      <SheetReason>
        Connect your Gmail and Roamly reads only your booking confirmations there — flights,
        hotels, tours — checks their dates, times and places, and keeps this trip up to date. Never
        your other mail. Gmail is the only mailbox Roamly connects to.
      </SheetReason>
      <PrimaryButton onClick={props.onConnect}>Connect Gmail</PrimaryButton>
      <BuiButton type="button" variant="ghost" onClick={props.onNotNow} className="mt-[6px] w-full">
        Not now
      </BuiButton>
      <SheetMicro>
        Without it, Roamly can&apos;t update this trip from your bookings — times here stay as
        first planned.
      </SheetMicro>
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ */
/* Ready card (READY — every gate green)                               */
/* ------------------------------------------------------------------ */

export function GateReadyView(props: {
  gmailArmed: boolean;
  gmailConnected: boolean;
  onConnectGmail: () => void;
  onContinue?: () => void;
}) {
  return (
    <section
      data-measure="gates-ready-card"
      className="bui-enter mx-[14px] my-3 rounded-bui-card border border-chair bg-white px-[14px] py-[13px] shadow-bui-card"
    >
      <div className="flex gap-[11px] py-[7px]">
        <span className="mt-[1px] flex h-6 w-6 flex-none items-center justify-center rounded-full bg-cgreen text-[13.5px] font-extrabold text-white">
          <Check size={14} strokeWidth={3} aria-hidden="true" />
        </span>
        <div>
          <p className="text-[14.5px] font-bold text-chead">Roamly app — installed, alerts on</p>
          <p className="mt-[1px] text-[12.5px] leading-[1.35] text-cgray">
            Detected on this phone. Trip alerts are on — that&apos;s how your companion reaches you.
          </p>
        </div>
      </div>
      <div className="flex gap-[11px] border-t border-chair py-[7px]">
        {props.gmailArmed || props.gmailConnected ? (
          <>
            <span className="mt-[1px] flex h-6 w-6 flex-none items-center justify-center rounded-full bg-cgreen text-[13.5px] font-extrabold text-white">
          <Check size={14} strokeWidth={3} aria-hidden="true" />
        </span>
            <div>
              <p className="text-[14.5px] font-bold text-chead">Gmail — connected</p>
              <p className="mt-[1px] text-[12.5px] leading-[1.35] text-cgray">
                Booking updates are on. Roamly reads booking confirmations only in your Gmail.
              </p>
            </div>
          </>
        ) : (
          <>
            <Image src={GATE_LOGO_SRC} alt="" width={24} height={24} className="mt-[1px] h-6 w-6 flex-none rounded-[7px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-bold text-chead">Connect Gmail</p>
              <p className="mt-[1px] text-[12.5px] leading-[1.35] text-cgray">
                So this trip can keep itself matched to your bookings — booking confirmations only,
                never your other mail.
              </p>
              <BuiButton type="button" size="small" onClick={props.onConnectGmail} className="mt-2">
                Connect Gmail
              </BuiButton>
            </div>
          </>
        )}
      </div>
      {props.onContinue ? (
        <BuiButton type="button" onClick={props.onContinue} className="mt-2 w-full">
          Continue to my trip
        </BuiButton>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Handoff landing states                                              */
/* ------------------------------------------------------------------ */

export function HandoffOpeningView() {
  return (
    <SheetShell measure="handoff-opening-sheet">
      <BrandRow step="FROM YOUR COMPUTER" />
      <SheetTitle>Opening your trip…</SheetTitle>
      <SheetReason>
        This is the same trip, on your phone. One moment while Roamly checks your code.
      </SheetReason>
    </SheetShell>
  );
}

export function HandoffFreshCodeView() {
  return (
    <SheetShell measure="handoff-fresh-code-sheet">
      <BrandRow step="FROM YOUR COMPUTER" />
      <SheetTitle>This code has been used or has expired</SheetTitle>
      <SheetReason>
        Handoff codes work once and last 10 minutes. Open Roamly on your computer and choose{" "}
        <b className="text-chead">“Take this trip with you”</b> to get a fresh code — or just
        sign in here; your trip lives on your account.
      </SheetReason>
    </SheetShell>
  );
}

export { EMAIL_REFUSAL_MESSAGE, INSTALL_BANNER_LINE, ALERTS_BANNER_LINE };
