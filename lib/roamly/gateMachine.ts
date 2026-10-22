/*
 * Build 2 entry gates — the shared TS gate policy (DESIGN-PRODUCTION.md
 * §2.4, Phase 6). This is the TypeScript port of the accepted shadow
 * state machine (build2-entry-gates-2026-10-21/src/gates.mjs, proof
 * 26/26); the shadow file remains a behavior reference only.
 *
 * Owner rulings implemented here, verbatim:
 *  - Install is persistent + required on mobile (2026-10-21 18:52 ADT):
 *    the popup never dismisses, it MINIMIZES to a 46px banner; the
 *    itinerary does not proceed without a DETECTED install.
 *  - "Live companion is never for desktop. Only for mobile."
 *    (2026-10-21 18:54 ADT): no gate, no companion surface on desktop.
 *  - "Alerts required too — no alerts, no proceed." (2026-10-21
 *    19:14 ADT): READY requires the detected install AND notification
 *    permission GRANTED, read from platform state. A denial stays red
 *    and blocked with a guided settings path; no timeout, no
 *    self-report, and no workaround reaches READY.
 *  - "and email is only gmail." (2026-10-21 19:16 ADT): the email gate
 *    connects Gmail via Google OAuth, provider fixed; any other
 *    mailbox named in a connect attempt is refused GMAIL_ONLY.
 *  - The desktop→phone move is the QR code (2026-10-21 19:15 ADT):
 *    a signed, 10-minute, single-use pass bound to account + trip,
 *    burned on first use (the token service is handoffTokens.ts).
 *
 * Self-report NEVER flips anything in this machine: "I've installed
 * it" requests a detection re-check; "I've turned them on" requests a
 * permission re-check. Only platform-state events move the machine.
 */

import type { InstallGateState } from "@/lib/roamly/engine/types";

export const INSTALL_BLOCK_MESSAGE =
  "Install Roamly to continue — trip alerts only work once the app is on your phone.";

export const EMAIL_REFUSAL_MESSAGE =
  "Connect your Gmail so Roamly can keep this trip matched to your bookings. " +
  "Roamly reads booking confirmations only in your Gmail — never your other mail, and no other mailbox.";

export const GMAIL_ONLY_MESSAGE =
  "Roamly connects to Gmail only — that is the one mailbox it can read.";

export const ALERTS_BLOCK_MESSAGE =
  "Turn on trip alerts to continue — your companion can only look after you if it can reach you.";

export const INSTALL_BANNER_LINE = "Install Roamly to continue";
export const ALERTS_BANNER_LINE = "Turn on trip alerts to continue";

/** The consent scope recorded before any Gmail read (Phase 1 DTO law). */
export const GMAIL_CONSENT_SCOPE = "booking-confirmations-only-in-gmail";

/** Plain human settings paths for the guided-enable step, per platform. */
export const ALERTS_SETTINGS_PATH: Readonly<Record<string, string>> = {
  ios: "Settings → Roamly → Notifications → turn on Allow Notifications",
  android: "Settings → Apps → Roamly → Notifications → turn on All Roamly notifications",
  other: "Settings → Apps → Roamly → Notifications → turn on All Roamly notifications"
};

export type GatePlatform = "ios" | "android" | "desktop" | "other";
export type GuidedKind = "native-prompt" | "numbered-steps" | "browser-steps";
export type GateSurface = "sheet" | "banner" | "none";
export type MinimizedFrom = "install" | "alerts";

const ALERTS_STEP_STATES: readonly InstallGateState[] = ["NOTIFY_DENIED", "GUIDED_ENABLE"];

export type InstallGateEvent =
  | { type: "enter" }
  | { type: "tapInstall" }
  | { type: "tapLater" }
  | { type: "tapBanner" }
  | { type: "selfReportInstalled" }
  | { type: "standaloneDetected" }
  | { type: "notifyGranted" }
  | { type: "notifyDenied" }
  | { type: "tapSettingsSteps" }
  | { type: "selfReportAlertsOn" }
  | { type: "permissionRecheck"; permission: "granted" | "denied" | "default" };

export interface InstallGateDispatchResult {
  state: InstallGateState;
  applicable?: boolean;
  surface?: GateSurface;
  guidedKind?: GuidedKind;
  flipped?: boolean;
  reason?: string;
  alerts?: boolean | null;
  green?: boolean;
  settingsPath?: string;
}

export interface InstallGate {
  readonly kind: "install";
  platform: GatePlatform;
  nativePromptAvailable: boolean;
  state: InstallGateState;
  surface: GateSurface;
  guidedKind: GuidedKind | null;
  /** null until the platform permission is read; then true | false. */
  alerts: boolean | null;
  minimizedFrom: MinimizedFrom | null;
  recheckRequested: boolean;
  permissionRecheckRequested: boolean;
  history: InstallGateState[];
  isGreen(): boolean;
  bannerLine(): string | null;
  settingsPath(): string;
  dispatch(event: InstallGateEvent): InstallGateDispatchResult;
}

export function createInstallGate(options: {
  platform?: GatePlatform;
  nativePromptAvailable?: boolean;
} = {}): InstallGate {
  const gate: InstallGate = {
    kind: "install",
    platform: options.platform ?? "android",
    nativePromptAvailable: options.nativePromptAvailable ?? false,
    state: "NOT_INSTALLED",
    surface: "none",
    guidedKind: null,
    alerts: null,
    minimizedFrom: null,
    recheckRequested: false,
    permissionRecheckRequested: false,
    history: ["NOT_INSTALLED"],

    isGreen() {
      return this.state === "READY";
    },

    bannerLine() {
      if (this.state !== "MINIMIZED") return null;
      return this.minimizedFrom === "alerts" ? ALERTS_BANNER_LINE : INSTALL_BANNER_LINE;
    },

    settingsPath() {
      return ALERTS_SETTINGS_PATH[this.platform] ?? ALERTS_SETTINGS_PATH.android;
    },

    dispatch(event: InstallGateEvent): InstallGateDispatchResult {
      const go = (state: InstallGateState, surface?: GateSurface) => {
        this.state = state;
        if (surface !== undefined) this.surface = surface;
        this.history.push(state);
      };

      switch (event.type) {
        case "enter": {
          if (this.platform === "desktop") {
            // The install gate is a mobile-flow gate only (owner ruling,
            // 2026-10-21 18:54 ADT). On desktop it never presents.
            return { state: this.state, applicable: false, surface: "none" };
          }
          if (this.state === "NOT_INSTALLED") go("PROMPT", "sheet");
          return { state: this.state, applicable: true };
        }

        case "tapInstall": {
          if (this.state !== "PROMPT" && !(this.state === "MINIMIZED" && this.minimizedFrom === "install")) {
            return { state: this.state };
          }
          if (this.platform === "android" && this.nativePromptAvailable) this.guidedKind = "native-prompt";
          else if (this.platform === "ios") this.guidedKind = "numbered-steps";
          else this.guidedKind = "browser-steps";
          go("GUIDED", "sheet");
          return { state: this.state, guidedKind: this.guidedKind };
        }

        case "tapLater": {
          // Dismissing NEVER clears the gate — it minimizes to the
          // banner, on the install step and on the alerts step alike.
          if (this.state === "PROMPT" || this.state === "GUIDED") {
            this.minimizedFrom = "install";
            go("MINIMIZED", "banner");
          } else if (this.state === "NOTIFY_ASK" || ALERTS_STEP_STATES.includes(this.state)) {
            this.minimizedFrom = "alerts";
            go("MINIMIZED", "banner");
          }
          return { state: this.state, green: this.isGreen() };
        }

        case "tapBanner": {
          // Tapping the banner reopens the step it stands for: the
          // install popup, or the alerts step in its blocked form.
          if (this.state === "MINIMIZED") {
            if (this.minimizedFrom === "alerts") go("NOTIFY_DENIED", "sheet");
            else go("PROMPT", "sheet");
          }
          return { state: this.state };
        }

        case "selfReportInstalled": {
          // "I've installed it" triggers a re-check only. It can never
          // set the state — detection is the only path forward.
          this.recheckRequested = true;
          return { flipped: false, reason: "DETECTION_REQUIRED", state: this.state };
        }

        case "standaloneDetected": {
          // The one honest install signal: display-mode standalone /
          // navigator.standalone.
          if (
            this.state === "PROMPT" ||
            this.state === "GUIDED" ||
            (this.state === "MINIMIZED" && this.minimizedFrom === "install")
          ) {
            this.minimizedFrom = null;
            go("INSTALLED_DETECTED", "none");
            go("NOTIFY_ASK", "sheet");
          }
          return { state: this.state };
        }

        case "notifyGranted": {
          // The platform permission prompt itself reported GRANTED — a
          // platform state, not a self-report.
          if (this.state === "NOTIFY_ASK") {
            this.alerts = true;
            go("READY", "none");
          }
          return { state: this.state, alerts: this.alerts };
        }

        case "notifyDenied": {
          // Owner ruling (2026-10-21 19:14 ADT): a denial does NOT
          // pass. The gate stays red and the flow stays blocked; the
          // traveler is shown the guided-enable path instead.
          if (this.state === "NOTIFY_ASK") {
            this.alerts = false;
            go("NOTIFY_DENIED", "sheet");
          }
          return { state: this.state, alerts: this.alerts, green: this.isGreen() };
        }

        case "tapSettingsSteps": {
          if (this.state === "NOTIFY_DENIED") go("GUIDED_ENABLE", "sheet");
          return { state: this.state, settingsPath: this.settingsPath() };
        }

        case "selfReportAlertsOn": {
          // "I've turned them on" triggers a permission re-check only.
          // The state changes only when the re-check reads GRANTED.
          this.permissionRecheckRequested = true;
          return { flipped: false, reason: "PERMISSION_STATE_REQUIRED", state: this.state };
        }

        case "permissionRecheck": {
          // Runs on return/foreground. The payload permission is the
          // platform permission state as read (Notification.permission
          // / push subscription) — the only input this event trusts.
          const onAlertsStep =
            this.state === "NOTIFY_ASK" ||
            ALERTS_STEP_STATES.includes(this.state) ||
            (this.state === "MINIMIZED" && this.minimizedFrom === "alerts");
          if (!onAlertsStep) return { state: this.state, flipped: false };
          this.permissionRecheckRequested = false;
          if (event.permission === "granted") {
            this.alerts = true;
            this.minimizedFrom = null;
            go("READY", "none");
            return { state: this.state, flipped: true, alerts: true };
          }
          // Still denied at OS level: the machine stays blocked with
          // the settings path. No timeout and no workaround reaches
          // READY.
          this.alerts = false;
          if (this.state === "NOTIFY_ASK") go("NOTIFY_DENIED", "sheet");
          return { state: this.state, flipped: false, alerts: false, settingsPath: this.settingsPath() };
        }

        default:
          return { state: this.state };
      }
    }
  };
  return gate;
}

/* ------------------------------------------------------------------ */
/* Connect Gmail gate (owner decision, 2026-10-21 19:16 ADT)          */
/* NOT_CONNECTED -> ASK -> CONNECTED -> RECONCILIATION_ARMED          */
/* ------------------------------------------------------------------ */

export type EmailGateState = "NOT_CONNECTED" | "ASK" | "CONNECTED" | "RECONCILIATION_ARMED";

export interface GmailConsentRecord {
  scope: string;
  provider: "gmail";
  recordedAt: string | null;
}

export type EmailGateEvent =
  | { type: "ask" }
  | { type: "decline" }
  | { type: "connect"; provider?: string; at?: string };

export interface EmailGateDispatchResult {
  state: EmailGateState;
  refused?: boolean;
  reason?: string;
  message?: string;
  green?: boolean;
  consent?: GmailConsentRecord | null;
}

export interface EmailGate {
  readonly kind: "email";
  readonly provider: "gmail";
  readonly providerOptions: readonly ["gmail"];
  readonly authMethod: "google-oauth";
  state: EmailGateState;
  consent: GmailConsentRecord | null;
  history: EmailGateState[];
  isGreen(): boolean;
  dispatch(event: EmailGateEvent): EmailGateDispatchResult;
}

export function createEmailGate(): EmailGate {
  const gate: EmailGate = {
    kind: "email",
    provider: "gmail", // fixed — never a choice (owner, 2026-10-21 19:16 ADT)
    providerOptions: ["gmail"],
    authMethod: "google-oauth",
    state: "NOT_CONNECTED",
    consent: null,
    history: ["NOT_CONNECTED"],

    isGreen() {
      return this.state === "RECONCILIATION_ARMED";
    },

    dispatch(event: EmailGateEvent): EmailGateDispatchResult {
      const go = (state: EmailGateState) => {
        this.state = state;
        this.history.push(state);
      };

      switch (event.type) {
        case "ask": {
          if (this.state === "NOT_CONNECTED") go("ASK");
          return { state: this.state };
        }

        case "decline": {
          if (this.state === "ASK") go("NOT_CONNECTED");
          return { state: this.state, green: this.isGreen() };
        }

        case "connect": {
          // Gmail is the only provider this gate can connect. Any other
          // mailbox named in a connect attempt is refused, plainly.
          if (event.provider !== undefined && event.provider !== "gmail") {
            return { state: this.state, refused: true, reason: "GMAIL_ONLY", message: GMAIL_ONLY_MESSAGE };
          }
          if (this.state === "ASK" || this.state === "NOT_CONNECTED") {
            // Consent is recorded with its scope — booking
            // confirmations only, in the connected Gmail — before
            // anything is read.
            this.consent = {
              scope: GMAIL_CONSENT_SCOPE,
              provider: "gmail",
              recordedAt: event.at ?? null
            };
            go("CONNECTED");
            go("RECONCILIATION_ARMED");
          }
          return { state: this.state, consent: this.consent };
        }

        default:
          return { state: this.state };
      }
    }
  };
  return gate;
}

/* ------------------------------------------------------------------ */
/* Flow guard — the itinerary flow consults the gates; it never       */
/* negotiates.                                                        */
/* ------------------------------------------------------------------ */

export type FlowDevice = "mobile" | "desktop";

export interface ProceedDecision {
  status: "OK" | "BLOCKED" | "NO_INSTALL_GATE_ON_DESKTOP";
  proceeds: boolean;
  reason: "INSTALL_REQUIRED" | "ALERTS_REQUIRED" | null;
  message: string | null;
  companionAvailable?: boolean;
  companionGateAppliesOn?: "mobile";
}

export interface ReconciliationDecision {
  ok: boolean;
  refusal: string | null;
}

export interface FlowGuard {
  device: FlowDevice;
  canProceedToItinerary(): ProceedDecision;
  canRunReconciliation(): ReconciliationDecision;
  attemptReconciliationLeg(signal: { facts: readonly unknown[] }): {
    ran: boolean;
    aligned: number;
    refusal: string | null;
  };
}

export function createFlowGuard(options: {
  installGate: InstallGate;
  emailGate: EmailGate;
  device?: FlowDevice;
}): FlowGuard {
  const { installGate, emailGate } = options;
  const guard: FlowGuard = {
    device: options.device ?? "mobile",

    canProceedToItinerary(): ProceedDecision {
      if (this.device === "desktop") {
        // Owner ruling (2026-10-21 18:54 ADT): the companion is
        // mobile-only and does not exist on desktop, so there is no
        // install gate in the desktop planning flow at all. The gate
        // applies later, on the phone, when the trip is opened there.
        return {
          status: "NO_INSTALL_GATE_ON_DESKTOP",
          proceeds: true,
          reason: null,
          message: null,
          companionAvailable: false,
          companionGateAppliesOn: "mobile"
        };
      }
      if (!installGate.isGreen()) {
        // The block names whichever half of the gate is still owed:
        // the install, or — once installed — the alerts.
        const alertsOwed =
          installGate.state === "NOTIFY_ASK" ||
          installGate.state === "NOTIFY_DENIED" ||
          installGate.state === "GUIDED_ENABLE" ||
          (installGate.state === "MINIMIZED" && installGate.minimizedFrom === "alerts");
        if (alertsOwed) {
          return { status: "BLOCKED", proceeds: false, reason: "ALERTS_REQUIRED", message: ALERTS_BLOCK_MESSAGE };
        }
        return { status: "BLOCKED", proceeds: false, reason: "INSTALL_REQUIRED", message: INSTALL_BLOCK_MESSAGE };
      }
      return { status: "OK", proceeds: true, reason: null, message: null };
    },

    canRunReconciliation(): ReconciliationDecision {
      if (!emailGate.isGreen()) {
        return { ok: false, refusal: EMAIL_REFUSAL_MESSAGE };
      }
      return { ok: true, refusal: null };
    },

    attemptReconciliationLeg(signal: { facts: readonly unknown[] }) {
      // The owner chain's first leg, gated: reconciliation facts may
      // only flow to the Updater while the email gate is armed.
      const check = this.canRunReconciliation();
      if (!check.ok) return { ran: false, aligned: 0, refusal: check.refusal };
      return { ran: true, aligned: signal.facts.length, refusal: null };
    }
  };
  return guard;
}

/* ------------------------------------------------------------------ */
/* Desktop handoff descriptor (owner, 2026-10-21 18:56 + 19:15 ADT)   */
/* ------------------------------------------------------------------ */

export interface DesktopHandoffDescriptor {
  tripRef: string;
  surface: "desktop-planning";
  headline: string;
  channels: readonly ["qr-code", "emailed-link"];
  companionUiOnDesktop: false;
  landsOn: string;
  gatesRunOn: "mobile";
  companionArmsWhen: string;
  ifNeverOpenedOnPhone: string;
  serverSideRegardless: readonly ["reconciliation", "updater-silent-alignment"];
  qrPass: {
    shownAt: readonly ["end-of-desktop-planning", "desktop-trip-page"];
    headline: string;
    encodes: string;
    token: {
      signed: true;
      ttlMinutes: 10;
      singleUse: true;
      burnsAfterFirstUse: true;
      boundTo: readonly ["account", "trip"];
    };
    onScan: string;
    expiredOrUsed: string;
    fallbacksInOrder: readonly [string, string];
    afterLanding: string;
  };
  emailedLinkTo: "connected-gmail";
  postTripReviewEmailTo: "connected-gmail";
}

export function desktopHandoff(tripRef: string): DesktopHandoffDescriptor {
  return {
    tripRef,
    surface: "desktop-planning", // a planning surface — never companion UI
    headline: "Your trip is ready — take it with you",
    channels: ["qr-code", "emailed-link"],
    companionUiOnDesktop: false,
    landsOn: "the same trip, on the phone (mobile web or installed app)",
    gatesRunOn: "mobile",
    companionArmsWhen: "install detected + alerts granted on the phone (owner, 2026-10-21 19:14 ADT)",
    ifNeverOpenedOnPhone: "no companion; view and print still work",
    serverSideRegardless: ["reconciliation", "updater-silent-alignment"],
    // The move itself (owner, 2026-10-21 19:15 ADT: "How can this be
    // moved on phone? through QR code?"): the QR code IS the move.
    qrPass: {
      shownAt: ["end-of-desktop-planning", "desktop-trip-page"],
      headline: "Take this trip with you",
      encodes: "a signed, short-lived, single-use handoff URL tied to the account + this trip",
      token: {
        signed: true,
        ttlMinutes: 10, // minutes, not days
        singleUse: true,
        burnsAfterFirstUse: true,
        boundTo: ["account", "trip"]
      },
      onScan:
        "lands directly on this trip and binds the phone session to the account — even if the phone was never signed in",
      expiredOrUsed: "a plain \"ask for a fresh code\" state — never an error dump",
      fallbacksInOrder: [
        "emailed link to the connected Gmail — the same one-time-pass design",
        "plain sign-in on the phone — the trip lives on the account, so sign-in alone finds it"
      ],
      afterLanding: "the install + alerts gates run as specified; then the companion arms"
    },
    // Owner decision (2026-10-21 19:16 ADT): the fallback link and the
    // post-trip review email both go to the connected Gmail — the only
    // mailbox Build 2 knows.
    emailedLinkTo: "connected-gmail",
    postTripReviewEmailTo: "connected-gmail"
  };
}
