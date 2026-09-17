"use client";

import { useState } from "react";

type Props = { endpoint?: string };

export function MetaVisibilityDiagnostic({ endpoint = "/api/admin/social/meta-diagnostics" }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "GET", credentials: "include", cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Meta diagnosis failed.");
      setResult(data?.diagnostic || data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Meta diagnosis failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-cloud bg-white/92 p-4 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Meta visibility diagnosis</p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">Read-only Page, token, Reel, and restriction evidence. No Facebook write is possible from this control.</p>
      <button type="button" onClick={run} disabled={busy} className="mt-4 rounded-xl bg-ink px-4 py-3 text-sm font-black text-white disabled:bg-slate-300">
        {busy ? "Running…" : "Run Meta visibility diagnosis"}
      </button>
      {error ? <p className="mt-3 rounded-xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
      {result ? <pre className="mt-4 max-h-[32rem] overflow-auto rounded-xl bg-mist p-4 text-xs font-bold text-slate-700">{JSON.stringify(result, null, 2)}</pre> : null}
    </section>
  );
}
