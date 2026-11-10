"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BuiButton } from "@/components/boardui/Button";

export function MarketPriceRefreshButton({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refreshPrices() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/roamly/market-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip_id: tripId, force_refresh: true })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not refresh market prices.");
      const warningCount = Array.isArray(data?.warnings) ? data.warnings.length : 0;
      setMessage(
        warningCount
          ? "Search links refreshed. Some live provider prices still need verification."
          : "Market prices refreshed."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh market prices.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="roamly-no-print flex flex-col gap-2">
      <BuiButton variant="secondary" onClick={refreshPrices} busy={busy} className="w-fit">
        {busy ? "Refreshing prices..." : "Refresh prices"}
      </BuiButton>
      {message ? <p className="text-xs font-bold leading-5 text-cblue">{message}</p> : null}
      {error ? <p className="text-xs font-bold leading-5 text-coral">{error}</p> : null}
    </div>
  );
}
