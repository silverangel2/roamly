"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

export function MediaAssetActions({ id }: { id: string }) {
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function act(action: string, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(action);
    setNotice("");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/social/media", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Media update failed.");
      setNotice("Media updated.");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Media update failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {[
          ["approve", "Approve", ""],
          ["include", "Include", ""],
          ["exclude", "Exclude", ""],
          ["reject", "Reject", "Reject this media asset for automation?"],
          ["archive", "Archive", "Archive this media asset?"]
        ].map(([action, label, confirmMessage]) => (
          <button
            key={action}
            type="button"
            onClick={() => act(action, confirmMessage || undefined)}
            disabled={Boolean(busy)}
            className="rounded-xl bg-white px-4 py-2 text-sm font-black text-ink shadow-soft ring-1 ring-cloud disabled:opacity-60"
          >
            {busy === action ? "Working..." : label}
          </button>
        ))}
      </div>
      {notice ? <p className="mt-3 rounded-xl bg-ocean/10 px-4 py-2 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-xl bg-coral/10 px-4 py-2 text-sm font-black text-coral">{error}</p> : null}
    </div>
  );
}
