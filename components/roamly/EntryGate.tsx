"use client";

/*
 * EntryGate — the Build 2 entry gates in the mobile flow (Phase 6,
 * DESIGN-PRODUCTION.md §2.4). Mounted in the plan→generate flow and on
 * the trip page pre-generation; the server enforces the same gate in
 * the generate route, so this component is the traveler's surface,
 * not the security boundary.
 *
 * Owner law rendered here (gateMachine.ts carries the full text):
 *  - Mobile only. On desktop this component renders nothing, ever —
 *    the companion does not exist there (2026-10-21 18:54 ADT).
 *  - The popup never dismisses; Later minimizes it to the 46px
 *    persistent banner (2026-10-21 18:52 ADT).
 *  - READY requires the install DETECTED (display-mode standalone)
 *    and alerts GRANTED (platform permission state + a server-verified
 *    push subscription). Self-report flips nothing — the "I've
 *    installed it" / "Check again" actions only trigger re-checks
 *    (2026-10-21 19:14 ADT).
 *  - Gmail is the only mailbox (2026-10-21 19:16 ADT): the ready card
 *    offers the Gmail connect — there is no other provider anywhere.
 *
 * With ROAMLY_BUILD2_GATES_ENABLED off (the default), the status
 * endpoint reports the lane disabled and this component renders
 * nothing — pre-Build-2 behavior, including PR #44's dismissible
 * post-purchase step, is untouched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import {
  getNotificationPermissionState,
  getPushCapabilityState,
  isSupportedMobileEnvironment,
  requestNotificationPermission,
  subscribeToPushNotifications
} from "@/lib/roamly/pushClient";
import {
  createFlowGuard,
  createEmailGate,
  createInstallGate,
  type GatePlatform,
  type InstallGate
} from "@/lib/roamly/gateMachine";
import type { GateStateDTO } from "@/lib/roamly/engine/types";
import {
  AlertsAskSheetView,
  AlertsDeniedSheetView,
  GateBannerView,
  GateReadyView,
  GmailAskSheetView,
  InstallSheetView
} from "@/components/roamly/gateViews";

const DEVICE_ID_KEY = "roamly:device-id:v1";

export function getOrCreateGateDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `device-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export function gateFlowSurface(): "mobile" | "desktop" {
  return isSupportedMobileEnvironment() ? "mobile" : "desktop";
}

export interface EntryGateReadiness {
  applicable: boolean;
  ready: boolean;
  reason: "INSTALL_REQUIRED" | "ALERTS_REQUIRED" | null;
  deviceId: string | null;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectPlatform(): GatePlatform {
  if (typeof window === "undefined") return "other";
  const capability = getPushCapabilityState();
  if (capability.isIOS) return "ios";
  return /Android/i.test(navigator.userAgent || "") ? "android" : "other";
}

export function EntryGate(props: {
  tripId?: string | null;
  onReadinessChange?: (readiness: EntryGateReadiness) => void;
}) {
  const [machine] = useState<InstallGate>(() => createInstallGate({ platform: "android" }));
  const [, setTick] = useState(0);
  const [applicable, setApplicable] = useState(false);
  const [serverGate, setServerGate] = useState<GateStateDTO | null>(null);
  const [gmailSheetOpen, setGmailSheetOpen] = useState(false);
  const deferredPromptRef = useRef<InstallPromptEvent | null>(null);
  const startedRef = useRef(false);
  const deviceIdRef = useRef<string | null>(null);
  const readinessRef = useRef(props.onReadinessChange);
  readinessRef.current = props.onReadinessChange;

  const bump = useCallback(() => setTick((tick) => tick + 1), []);

  const notifyReadiness = useCallback(() => {
    const callback = readinessRef.current;
    if (!callback) return;
    const ready = machine.isGreen() || serverGate?.flowAllowed === true;
    const guard = createFlowGuard({ installGate: machine, emailGate: createEmailGate(), device: "mobile" });
    const decision = guard.canProceedToItinerary();
    callback({
      applicable,
      ready: applicable ? ready : true,
      reason: applicable && !ready ? decision.reason : null,
      deviceId: deviceIdRef.current
    });
  }, [applicable, machine, serverGate]);

  useEffect(() => {
    notifyReadiness();
  }, [notifyReadiness, machine.state, serverGate, applicable]);

  const postGateCheck = useCallback(
    async (evidence: {
      standaloneDetected: boolean;
      notificationPermission: "granted" | "denied" | "default";
      pushEndpoint?: string | null;
    }): Promise<GateStateDTO | null> => {
      const deviceId = deviceIdRef.current;
      if (!deviceId) return null;
      const response = await fetchWithSupabaseAuth("/api/roamly/gates/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, platform: machine.platform, evidence })
      }).catch(() => null);
      if (!response?.ok) return null;
      const data = (await response.json().catch(() => null)) as { gate?: GateStateDTO } | null;
      if (data?.gate) setServerGate(data.gate);
      return data?.gate ?? null;
    },
    [machine]
  );

  const currentPushEndpoint = useCallback(async (): Promise<string | null> => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
    const subscription = await registration?.pushManager.getSubscription().catch(() => null);
    return subscription?.endpoint ?? null;
  }, []);

  /** Granted-permission path: subscribe for real, then let the server verify. */
  const verifyGrantedWithServer = useCallback(async () => {
    await subscribeToPushNotifications(props.tripId ?? undefined).catch(() => null);
    const endpoint = await currentPushEndpoint();
    const gate = await postGateCheck({
      standaloneDetected: true,
      notificationPermission: "granted",
      pushEndpoint: endpoint
    });
    if (gate?.flowAllowed && !machine.isGreen()) {
      // The server record is green; bring the local machine to READY
      // through its own platform-state events (never by assignment).
      if (machine.state === "NOT_INSTALLED" || machine.state === "PROMPT" || machine.state === "GUIDED") {
        machine.dispatch({ type: "enter" });
        machine.dispatch({ type: "standaloneDetected" });
      }
      machine.dispatch({ type: "permissionRecheck", permission: "granted" });
      machine.dispatch({ type: "notifyGranted" });
    }
    bump();
  }, [bump, currentPushEndpoint, machine, postGateCheck, props.tripId]);

  /** Read fresh platform state and drive the machine from it. */
  const syncFromPlatform = useCallback(async () => {
    const capability = getPushCapabilityState();
    if (capability.isStandalone) {
      if (
        machine.state === "PROMPT" ||
        machine.state === "GUIDED" ||
        (machine.state === "MINIMIZED" && machine.minimizedFrom === "install")
      ) {
        machine.dispatch({ type: "standaloneDetected" });
      }
      const permission = await getNotificationPermissionState();
      if (permission === "granted") {
        await verifyGrantedWithServer();
        return;
      }
      if (permission === "denied") {
        if (machine.state === "NOTIFY_ASK") machine.dispatch({ type: "notifyDenied" });
        machine.dispatch({ type: "permissionRecheck", permission: "denied" });
        await postGateCheck({ standaloneDetected: true, notificationPermission: "denied" });
      }
    }
    bump();
  }, [bump, machine, postGateCheck, verifyGrantedWithServer]);

  // Bootstrap: mobile + lane-enabled only; otherwise render nothing.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!isSupportedMobileEnvironment()) return;
    machine.platform = detectPlatform();
    const deviceId = getOrCreateGateDeviceId();
    deviceIdRef.current = deviceId;
    if (!deviceId) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as InstallPromptEvent;
      machine.nativePromptAvailable = true;
      bump();
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    const onAppInstalled = () => void syncFromPlatform();
    window.addEventListener("appinstalled", onAppInstalled);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncFromPlatform();
    };
    document.addEventListener("visibilitychange", onVisibility);

    void (async () => {
      const platform = machine.platform === "ios" || machine.platform === "android" ? machine.platform : "other";
      const response = await fetchWithSupabaseAuth(
        `/api/roamly/gates/status?deviceId=${encodeURIComponent(deviceId)}&platform=${platform}`
      ).catch(() => null);
      const data = response?.ok
        ? ((await response.json().catch(() => null)) as { enabled?: boolean; gate?: GateStateDTO } | null)
        : null;
      if (!data?.enabled) return;
      setApplicable(true);
      if (data.gate) setServerGate(data.gate);
      if (data.gate?.flowAllowed) {
        bump();
        return;
      }
      machine.dispatch({ type: "enter" });
      bump();
      await syncFromPlatform();
    })();

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Bootstrap runs once (startedRef guards re-entry); every dep is a
    // stable identity by construction (useState machine, useCallback fns).
  }, [bump, machine, syncFromPlatform]);

  if (!applicable) return null;

  const ready = machine.isGreen() || serverGate?.flowAllowed === true;
  if (ready) {
    return (
      <>
        <GateReadyView
          gmailArmed={serverGate?.gmailState === "RECONCILIATION_ARMED"}
          gmailConnected={serverGate?.gmailState === "CONNECTED" || serverGate?.gmailState === "RECONCILIATION_ARMED"}
          onConnectGmail={() => setGmailSheetOpen(true)}
        />
        {gmailSheetOpen ? (
          <GmailAskSheetView
            onConnect={() => {
              window.location.href = "/api/integrations/gmail/connect";
            }}
            onNotNow={() => setGmailSheetOpen(false)}
          />
        ) : null}
      </>
    );
  }

  if (machine.state === "MINIMIZED") {
    return (
      <GateBannerView
        line={machine.bannerLine() ?? "Install Roamly to continue"}
        actionLabel={machine.minimizedFrom === "alerts" ? "Turn on" : "Install"}
        onTap={() => {
          machine.dispatch({ type: "tapBanner" });
          bump();
          void syncFromPlatform();
        }}
      />
    );
  }

  if (machine.state === "PROMPT" || machine.state === "GUIDED") {
    return (
      <InstallSheetView
        guided={machine.state === "GUIDED"}
        guidedKind={machine.guidedKind}
        onInstall={() => {
          const deferred = deferredPromptRef.current;
          machine.dispatch({ type: "tapInstall" });
          bump();
          if (deferred) {
            void deferred
              .prompt()
              .then(() => deferred.userChoice)
              .catch(() => null)
              .then(() => syncFromPlatform());
          }
        }}
        onLater={() => {
          machine.dispatch({ type: "tapLater" });
          bump();
        }}
        onSelfReportInstalled={() => {
          // Self-report flips nothing; it requests the detection
          // re-check, and detection alone moves the machine.
          machine.dispatch({ type: "selfReportInstalled" });
          void syncFromPlatform();
        }}
      />
    );
  }

  if (machine.state === "NOTIFY_ASK") {
    return (
      <AlertsAskSheetView
        onEnable={() => {
          void (async () => {
            const permission = await requestNotificationPermission();
            if (permission === "granted") {
              await verifyGrantedWithServer();
            } else if (permission === "denied") {
              machine.dispatch({ type: "notifyDenied" });
              await postGateCheck({ standaloneDetected: true, notificationPermission: "denied" });
              bump();
            }
          })();
        }}
        onLater={() => {
          machine.dispatch({ type: "tapLater" });
          bump();
        }}
      />
    );
  }

  if (machine.state === "NOTIFY_DENIED" || machine.state === "GUIDED_ENABLE") {
    return (
      <AlertsDeniedSheetView
        settingsPath={machine.settingsPath()}
        onCheckAgain={() => {
          // "I've turned them on" flips nothing by itself — the
          // re-check reads the platform permission state.
          machine.dispatch({ type: "selfReportAlertsOn" });
          void syncFromPlatform();
        }}
        onLater={() => {
          machine.dispatch({ type: "tapLater" });
          bump();
        }}
      />
    );
  }

  // NOT_INSTALLED (pre-enter) and INSTALLED_DETECTED (transient while
  // the notify step assembles) render nothing.
  return null;
}
