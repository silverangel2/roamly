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
import Image from "next/image";
import {
  ALERTS_BANNER_LINE,
  EMAIL_REFUSAL_MESSAGE,
  INSTALL_BANNER_LINE
} from "@/lib/roamly/gateMachine";

export const GATE_LOGO_SRC = "/icon-512.png";

function SheetShell(props: { children: ReactNode; measure?: string }) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[rgba(10,28,21,0.34)]" />
      <section
        data-measure={props.measure}
        className="absolute inset-x-0 bottom-0 rounded-t-[22px] bg-white px-5 pb-[26px] pt-[18px] shadow-[0_-12px_34px_rgba(8,44,32,0.22)]"
      >
        <div className="mx-auto mb-[14px] h-[4.5px] w-[38px] rounded-[3px] bg-[#d8e2dd]" />
        {props.children}
      </section>
    </div>
  );
}

function BrandRow(props: { step: string }) {
  return (
    <div className="flex items-center gap-[9px]">
      <Image src={GATE_LOGO_SRC} alt="Roamly logo" width={38} height={38} className="h-[38px] w-[38px] rounded-[10px]" />
      <span className="text-[17px] font-extrabold text-[#0b3d2b]">Roamly</span>
      <span className="ml-auto rounded-full bg-[#f7ecc9] px-2 py-1 text-[11px] font-bold tracking-[0.04em] text-[#7a5b12]">
        {props.step}
      </span>
    </div>
  );
}

function SheetTitle(props: { children: ReactNode }) {
  return <h2 className="mb-[7px] mt-[13px] text-[21.5px] font-extrabold leading-tight tracking-[-0.01em] text-[#12211b]">{props.children}</h2>;
}

function SheetReason(props: { children: ReactNode }) {
  return <p className="text-[14.5px] leading-[1.45] text-[#33463d]">{props.children}</p>;
}

function PrimaryButton(props: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="mt-4 block w-full rounded-[13px] bg-[#0b6e4f] py-[14.5px] text-center text-[16px] font-bold text-white"
    >
      {props.children}
    </button>
  );
}

function LaterButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="mt-[6px] block w-full py-[10.5px] text-center text-[14.5px] font-semibold text-[#46655a]"
    >
      Later
    </button>
  );
}

function SheetMicro(props: { children: ReactNode }) {
  return <p className="mt-[7px] text-center text-[12px] leading-[1.4] text-[#71837b]">{props.children}</p>;
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
        <b className="text-[#12211b]">that&apos;s a phone rule, not ours.</b> Installing takes a few
        seconds, and your itinerary continues right after.
      </SheetReason>
      {props.guided ? (
        <div className="mt-[13px] rounded-[12px] border border-[#dce8e1] bg-[#f2f6f4] px-[13px] py-[11px]">
          {props.guidedKind === "numbered-steps" ? (
            <ol className="list-none text-[13.5px] leading-[1.5] text-[#33463d]">
              <li><b className="text-[#12211b]">1.</b> Tap the Share icon in your browser.</li>
              <li><b className="text-[#12211b]">2.</b> Scroll and tap <b className="text-[#12211b]">Add to Home Screen</b>.</li>
              <li><b className="text-[#12211b]">3.</b> Tap <b className="text-[#12211b]">Add</b>, then open Roamly from your Home Screen.</li>
            </ol>
          ) : props.guidedKind === "native-prompt" ? (
            <p className="text-[13.5px] leading-[1.5] text-[#33463d]">
              Use your browser&apos;s install prompt to add Roamly to your Home Screen, then open it
              from that icon.
            </p>
          ) : (
            <p className="text-[13.5px] leading-[1.5] text-[#33463d]">
              In your browser menu, choose <b className="text-[#12211b]">Install app</b> or{" "}
              <b className="text-[#12211b]">Add to Home Screen</b>, then open Roamly from that icon.
            </p>
          )}
          <button
            type="button"
            onClick={props.onSelfReportInstalled}
            className="mt-2 text-[13px] font-semibold text-[#0b6e4f]"
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
      <div className="mt-[13px] rounded-[12px] border border-[#dce8e1] bg-[#f2f6f4] px-[13px] py-[11px]">
        <p className="text-[12px] font-bold tracking-[0.03em] text-[#0b6e4f]">TURN THEM ON — TAKES TEN SECONDS</p>
        <p className="mt-[3px] text-[13.5px] leading-[1.45] text-[#33463d]">
          <b className="text-[#12211b]">{props.settingsPath}</b>. Then come back here — Roamly
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
        className="flex h-[46px] w-full items-center gap-[9px] rounded-[12px] bg-[#0b3d2b] py-[9px] pl-[11px] pr-[10px] text-left text-[#eaf4ef] shadow-[0_5px_16px_rgba(8,44,32,0.20)]"
      >
        <Image src={GATE_LOGO_SRC} alt="" width={23} height={23} className="h-[23px] w-[23px] flex-none rounded-[6px] bg-white p-[2px]" />
        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-tight">
          {props.line}
          <span className="block truncate text-[11px] font-medium text-[#a9c8bb]">{subline}</span>
        </span>
        <span className="flex-none whitespace-nowrap rounded-[8px] bg-white px-[11px] py-[7px] text-[12.5px] font-bold text-[#0b3d2b]">
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
        <span className="text-[17px] font-extrabold text-[#0b3d2b]">Roamly</span>
        <span className="ml-auto rounded-full bg-[#f7ecc9] px-2 py-1 text-[11px] font-bold tracking-[0.04em] text-[#7a5b12]">
          CONNECT GMAIL
        </span>
      </div>
      <SheetTitle>Keep this trip matched to your bookings</SheetTitle>
      <SheetReason>
        Connect your Gmail and Roamly reads only your booking confirmations there — flights,
        hotels, tours — checks their dates, times and places, and keeps this trip up to date. Never
        your other mail. Gmail is the only mailbox Roamly connects to.
      </SheetReason>
      <PrimaryButton onClick={props.onConnect}>Connect Gmail</PrimaryButton>
      <button
        type="button"
        onClick={props.onNotNow}
        className="mt-[6px] block w-full py-[10.5px] text-center text-[14.5px] font-semibold text-[#46655a]"
      >
        Not now
      </button>
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
      className="mx-[14px] my-3 rounded-[16px] border border-[#dce8e1] bg-white px-[14px] py-[13px]"
    >
      <div className="flex gap-[11px] py-[7px]">
        <span className="mt-[1px] flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#0b6e4f] text-[13.5px] font-extrabold text-white">
          ✓
        </span>
        <div>
          <p className="text-[14.5px] font-bold text-[#12211b]">Roamly app — installed, alerts on</p>
          <p className="mt-[1px] text-[12.5px] leading-[1.35] text-[#5c6f66]">
            Detected on this phone. Trip alerts are on — that&apos;s how your companion reaches you.
          </p>
        </div>
      </div>
      <div className="flex gap-[11px] border-t border-[#eef3f0] py-[7px]">
        {props.gmailArmed || props.gmailConnected ? (
          <>
            <span className="mt-[1px] flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#0b6e4f] text-[13.5px] font-extrabold text-white">
              ✓
            </span>
            <div>
              <p className="text-[14.5px] font-bold text-[#12211b]">Gmail — connected</p>
              <p className="mt-[1px] text-[12.5px] leading-[1.35] text-[#5c6f66]">
                Booking updates are on. Roamly reads booking confirmations only in your Gmail.
              </p>
            </div>
          </>
        ) : (
          <>
            <Image src={GATE_LOGO_SRC} alt="" width={24} height={24} className="mt-[1px] h-6 w-6 flex-none rounded-[7px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-bold text-[#12211b]">Connect Gmail</p>
              <p className="mt-[1px] text-[12.5px] leading-[1.35] text-[#5c6f66]">
                So this trip can keep itself matched to your bookings — booking confirmations only,
                never your other mail.
              </p>
              <button
                type="button"
                onClick={props.onConnectGmail}
                className="mt-2 rounded-full bg-[#0b6e4f] px-4 py-2 text-[13px] font-bold text-white"
              >
                Connect Gmail
              </button>
            </div>
          </>
        )}
      </div>
      {props.onContinue ? (
        <button
          type="button"
          onClick={props.onContinue}
          className="mt-2 block w-full rounded-[13px] bg-[#0b6e4f] py-3 text-center text-[15px] font-bold text-white"
        >
          Continue to my trip
        </button>
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
        <b className="text-[#12211b]">“Take this trip with you”</b> to get a fresh code — or just
        sign in here; your trip lives on your account.
      </SheetReason>
    </SheetShell>
  );
}

export { EMAIL_REFUSAL_MESSAGE, INSTALL_BANNER_LINE, ALERTS_BANNER_LINE };
