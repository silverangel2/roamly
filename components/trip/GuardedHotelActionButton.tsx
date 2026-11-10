"use client";

import { useState } from "react";
import { BuiButton } from "@/components/boardui/Button";

export function GuardedHotelActionButton({ tripId, label }: { tripId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function continueToHotel() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/hotel-action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await response.json().catch(() => ({}));
      if (result?.action === "redirect" && typeof result.url === "string") {
        window.location.assign(result.url);
        return;
      }
      if (typeof result?.path === "string") {
        window.location.assign(result.path);
        return;
      }
      setError("The hotel action could not be verified. Please refresh the trip and try again.");
    } catch {
      setError("The hotel action could not be verified. Please refresh the trip and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BuiButton
        busy={busy}
        onClick={() => void continueToHotel()}
        className="roamly-no-print w-full sm:w-auto"
      >
        {busy ? "Checking latest hotel details…" : label}
      </BuiButton>
      {error ? <p className="max-w-[16rem] text-xs font-bold leading-5 text-coral">{error}</p> : null}
    </>
  );
}
