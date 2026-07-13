"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

type AffiliateTestStatus = {
  provider: string;
  category: string;
  configured: boolean;
  enabled: boolean;
  priority: number;
  finalUrlValid: boolean;
  disclosureRequired: boolean;
  fallbackBehavior: string;
  missingConfiguration: string[];
};

type AffiliateTestResult = {
  ok: boolean;
  testedAt: string;
  statuses: AffiliateTestStatus[];
};

export function AffiliateLinkTestButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AffiliateTestResult | null>(null);
  const [error, setError] = useState("");

  async function testLinks() {
    setBusy(true);
    setError("");
    setResult(null);

    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/affiliate/test", {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Affiliate link test failed.");
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Affiliate link test failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={testLinks}
        disabled={busy}
        className="rounded-2xl bg-ink px-4 py-3 text-sm font-black text-white shadow-soft transition hover:bg-ocean disabled:opacity-60"
      >
        {busy ? "Testing links..." : "Test affiliate links"}
      </button>
      {error ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
      {result ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-cloud bg-white">
          <div className="grid gap-1 border-b border-cloud px-4 py-3">
            <p className="text-sm font-black text-ink">{result.ok ? "All generated URLs are valid." : "One or more generated URLs failed validation."}</p>
            <p className="text-xs font-bold text-slate-500">Last validation: {new Date(result.testedAt).toLocaleString()}</p>
          </div>
          {result.statuses.map((status) => (
            <div key={`${status.provider}-${status.category}`} className="grid gap-2 border-b border-cloud px-4 py-3 last:border-b-0 sm:grid-cols-[9rem_1fr]">
              <p className="text-sm font-black text-ink">{status.provider}</p>
              <p className="text-sm font-semibold leading-6 text-slate-600">
                {status.category} · priority {status.priority} · {status.configured ? "configured" : "missing config"} · {status.finalUrlValid ? "URL valid" : "URL invalid"} · {status.fallbackBehavior}
                {status.missingConfiguration.length ? ` · missing ${status.missingConfiguration.join(", ")}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
