"use client";

import { useState } from "react";

export function DemoSeedButton() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function seed() {
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/admin/roamly/seed-demo", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Demo seed failed.");
      setNotice(`Toronto Weekend demo trip created: ${data.tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo seed failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={seed}
        disabled={busy}
        className="rounded-2xl bg-ink px-4 py-3 text-sm font-black text-white shadow-soft transition hover:bg-ocean disabled:opacity-60"
      >
        {busy ? "Creating demo..." : "Create Toronto demo trip"}
      </button>
      {notice ? <p className="mt-3 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </div>
  );
}
