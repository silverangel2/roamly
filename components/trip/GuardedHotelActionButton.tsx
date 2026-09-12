"use client";

import { useState } from "react";

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
      <button
        type="button"
        disabled={busy}
        onClick={() => void continueToHotel()}
        className="roamly-no-print inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-ocean/20 bg-ocean px-5 py-2.5 text-sm font-black text-white transition hover:bg-ocean/90 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Checking latest hotel details…" : label}
      </button>
      {error ? <p className="max-w-[16rem] text-xs font-bold leading-5 text-coral">{error}</p> : null}
    </>
  );
}
