"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

const primaryClass =
  "inline-flex min-h-11 min-w-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 disabled:pointer-events-none disabled:opacity-60 bg-cblue text-white shadow-[0_8px_20px_rgba(8,123,255,0.18)] hover:bg-[#071E55]";
const secondaryClass =
  "inline-flex min-h-11 min-w-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 disabled:pointer-events-none disabled:opacity-60 border border-[#d9d1c4] bg-[#fffdf8] text-ink shadow-sm hover:border-cblue/50 hover:bg-white hover:text-cblue";

export function RepairReviewActions({ tripId, repairId }: { tripId: string; repairId: string }) {
  const { translateText } = useI18n();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "approve" | "reject") {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/companion/repairs/${repairId}/${kind}`, {
        method: "POST"
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || data.ok === false) {
        throw new Error(typeof data.error === "string" && data.error ? data.error : translateText("Request failed. Please try again."));
      }
      window.location.href = `/trip/${tripId}/live`;
    } catch (err) {
      setError(err instanceof Error ? err.message : translateText("Request failed. Please try again."));
      setBusy(null);
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" className={primaryClass} disabled={busy !== null} onClick={() => run("approve")}>
          {busy === "approve" ? translateText("Applying…") : translateText("Approve new times")}
        </button>
        <button type="button" className={secondaryClass} disabled={busy !== null} onClick={() => run("reject")}>
          {busy === "reject" ? translateText("Saving…") : translateText("Keep original plan")}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm font-bold text-red-600">{error}</p> : null}
      <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
        {translateText("Approving only moves the plan times shown above. Keeping the original plan dismisses this repair.")}
      </p>
    </div>
  );
}
