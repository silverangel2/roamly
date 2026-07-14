"use client";

import { useEffect, useMemo, useState } from "react";

type EmailConnection = {
  provider: "gmail" | "outlook";
  email_address: string | null;
  connection_status: string;
  last_synced_at: string | null;
};

function formatSync(value: string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function EmailConnectionSettings() {
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const gmail = useMemo(() => connections.find((connection) => connection.provider === "gmail"), [connections]);
  const connected = gmail?.connection_status === "connected" || gmail?.connection_status === "syncing";

  async function load() {
    const response = await fetch("/api/account/email-connections", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (response.ok) setConnections(data.connections || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function post(url: string, action: string) {
    setBusy(action);
    setError("");
    try {
      const response = await fetch(url, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || "We could not update Gmail right now.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not update Gmail right now.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-black text-ink">Gmail travel emails</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
          Roamly checks for travel confirmations and travel changes. Personal emails are not saved or used for advertising.
        </p>
        <p className="mt-3 text-sm font-bold text-slate-500">
          {connected ? `${gmail?.email_address || "Gmail"} connected · Last sync ${formatSync(gmail?.last_synced_at || null)}` : "Not connected"}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {connected ? (
          <>
            <button
              type="button"
              onClick={() => void post("/api/integrations/gmail/sync", "sync")}
              disabled={Boolean(busy)}
              className="min-h-12 rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              {busy === "sync" ? "Syncing..." : "Sync Gmail"}
            </button>
            <button
              type="button"
              onClick={() => void post("/api/integrations/gmail/disconnect", "disconnect")}
              disabled={Boolean(busy)}
              className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-ink disabled:opacity-50"
            >
              {busy === "disconnect" ? "Disconnecting..." : "Disconnect Gmail"}
            </button>
          </>
        ) : (
          <a
            href="/api/integrations/gmail/connect"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white"
          >
            Connect Gmail
          </a>
        )}
      </div>

      {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">{error}</p> : null}
    </div>
  );
}
