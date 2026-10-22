"use client";

/*
 * HandoffBlock — the desktop end of the desktop→phone move (Phase 6;
 * owner rulings 2026-10-21 18:56 + 19:15 ADT). Desktop planning ends
 * with "Your trip is ready — take it with you": a QR code carrying a
 * signed, 10-minute, single-use pass (M6) + an emailed-link fallback
 * to the connected Gmail.
 *
 * This is a PLANNING surface, never companion UI — and it renders only
 * on desktop. On a phone it renders nothing: the companion's world is
 * mobile, and a phone that opens the trip runs the entry gates
 * instead. The pass is minted on mount (and re-minted on demand when
 * it expires); only its hash is ever stored server-side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import { isSupportedMobileEnvironment } from "@/lib/roamly/pushClient";

type BlockState =
  | { phase: "loading" }
  | { phase: "ready"; url: string; expiresAt: string }
  | { phase: "expired" }
  | { phase: "emailed"; sentTo: string }
  | { phase: "gmail-missing" }
  | { phase: "error"; message: string };

export function HandoffBlock(props: { tripId: string }) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [state, setState] = useState<BlockState>({ phase: "loading" });
  const startedRef = useRef(false);

  const mint = useCallback(async () => {
    setState({ phase: "loading" });
    const response = await fetchWithSupabaseAuth("/api/roamly/handoff/mint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId: props.tripId })
    }).catch(() => null);
    const data = response?.ok
      ? ((await response.json().catch(() => null)) as { url?: string; expiresAt?: string } | null)
      : null;
    if (data?.url && data?.expiresAt) {
      setState({ phase: "ready", url: data.url, expiresAt: data.expiresAt });
    } else {
      setState({ phase: "error", message: "Roamly couldn't create a code just now. Try again in a moment." });
    }
  }, [props.tripId]);

  useEffect(() => {
    const mobile = isSupportedMobileEnvironment();
    setIsMobile(mobile);
    if (mobile || startedRef.current) return;
    startedRef.current = true;
    void mint();
  }, [mint]);

  // The pass lives 10 minutes; when it lapses, offer a fresh code —
  // the same plain state the phone side shows for an expired pass.
  useEffect(() => {
    if (state.phase !== "ready") return;
    const msLeft = Date.parse(state.expiresAt) - Date.now();
    if (msLeft <= 0) {
      setState({ phase: "expired" });
      return;
    }
    const timer = window.setTimeout(() => setState({ phase: "expired" }), msLeft);
    return () => window.clearTimeout(timer);
  }, [state]);

  const emailLink = useCallback(async () => {
    const response = await fetchWithSupabaseAuth("/api/roamly/handoff/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId: props.tripId })
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { sentTo?: string; error?: string } | null;
    if (response?.ok && data?.sentTo) {
      setState({ phase: "emailed", sentTo: data.sentTo });
    } else if (data?.error === "GMAIL_NOT_CONNECTED") {
      setState({ phase: "gmail-missing" });
    } else {
      setState({ phase: "error", message: "The email couldn't be sent just now. The QR code still works." });
    }
  }, [props.tripId]);

  if (isMobile === null || isMobile) return null;

  return (
    <section
      data-measure="handoff-block"
      className="roamly-no-print mx-[14px] my-3 rounded-[16px] border border-[#dce8e1] bg-white px-[14px] py-[13px] sm:mx-0"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[220px] flex-1">
          <p className="text-[11px] font-bold tracking-[0.04em] text-[#7a5b12]">TAKE THIS TRIP WITH YOU</p>
          <h2 className="mt-1 text-[17px] font-extrabold text-[#0b3d2b]">Your trip is ready — take it with you</h2>
          <p className="mt-1 max-w-md text-[13px] leading-[1.45] text-[#5c6f66]">
            Point your phone camera at the code. You&apos;ll land on this trip, and the install +
            alerts steps run there — that&apos;s where your companion lives.
          </p>
          {state.phase === "emailed" ? (
            <p className="mt-2 text-[13px] font-semibold text-[#0b6e4f]">Link sent to {state.sentTo} — it works once, for 10 minutes.</p>
          ) : null}
          {state.phase === "gmail-missing" ? (
            <p className="mt-2 text-[13px] text-[#5c6f66]">
              The emailed link goes to your connected Gmail —{" "}
              <a href="/api/integrations/gmail/connect" className="font-semibold text-[#0b6e4f] underline">
                connect Gmail
              </a>{" "}
              first, or use the QR code.
            </p>
          ) : null}
          {state.phase === "error" ? <p className="mt-2 text-[13px] text-[#5c6f66]">{state.message}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void emailLink()}
              className="rounded-full bg-[#0b6e4f] px-4 py-2 text-[13px] font-bold text-white"
            >
              Email me the link instead
            </button>
            {state.phase === "expired" || state.phase === "error" ? (
              <button
                type="button"
                onClick={() => void mint()}
                className="rounded-full border border-[#0b6e4f] px-4 py-2 text-[13px] font-bold text-[#0b6e4f]"
              >
                Get a fresh code
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex-none">
          {state.phase === "ready" ? (
            <div className="rounded-[12px] border border-[#dce8e1] bg-white p-2">
              <QRCodeSVG value={state.url} size={148} />
            </div>
          ) : (
            <div className="flex h-[164px] w-[164px] items-center justify-center rounded-[12px] border border-[#dce8e1] bg-[#f2f6f4] px-3 text-center text-[12px] leading-[1.4] text-[#5c6f66]">
              {state.phase === "loading"
                ? "Creating your code…"
                : state.phase === "expired"
                  ? "This code has expired — get a fresh one."
                  : "Your QR code appears here."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
