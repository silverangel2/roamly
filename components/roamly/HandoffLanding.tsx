"use client";

/*
 * HandoffLanding — the phone side of the desktop→phone move (Phase 6).
 * Redeems the pass with a POST on mount (never on a bare GET, so a
 * link preview can't burn it), and on success the server has already
 * bound this phone session to the account + trip — we navigate to the
 * trip, where the entry gates run. Every failure lands on the one
 * plain fresh-code state; the reason is never shown.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateGateDeviceId } from "@/components/roamly/EntryGate";
import { HandoffFreshCodeView, HandoffOpeningView } from "@/components/roamly/gateViews";

export function HandoffLanding(props: { token: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const deviceId = getOrCreateGateDeviceId() ?? `device-${Date.now()}`;
      const response = await fetch("/api/roamly/handoff/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: props.token, deviceId })
      }).catch(() => null);
      const data = response?.ok
        ? ((await response.json().catch(() => null)) as { tripId?: string } | null)
        : null;
      if (data?.tripId) {
        router.replace(`/trip/${data.tripId}`);
        return;
      }
      setFailed(true);
    })();
  }, [props.token, router]);

  return (
    <main className="min-h-screen bg-[#f2f6f4]">
      {failed ? <HandoffFreshCodeView /> : <HandoffOpeningView />}
    </main>
  );
}
