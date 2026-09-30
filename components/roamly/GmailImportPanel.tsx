"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRoamlyDate, type RoamlyLocale } from "@/lib/i18n";

type EmailConnectionState = {
  provider: string;
  email_address: string | null;
  connection_status: string;
  last_synced_at: string | null;
  disconnected_at: string | null;
};

type PendingImport = {
  id: string;
  tripId: string | null;
  bookingType: string | null;
  title: string | null;
  provider: string | null;
  confirmationCode: string | null;
  flightNumber: string | null;
  startTime: string | null;
  endTime: string | null;
  origin: string | null;
  destination: string | null;
  overallConfidence: number | null;
  matchReasons: string[];
};

function formatSync(value: string | null, locale: RoamlyLocale) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return formatRoamlyDate(date, locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDay(value: string | null, locale: RoamlyLocale) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatRoamlyDate(date, locale, { month: "short", day: "numeric" });
}

function importDateLine(item: PendingImport, locale: RoamlyLocale) {
  const start = formatDay(item.startTime, locale);
  const end = formatDay(item.endTime, locale);
  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  return "Dates to confirm";
}

function importRouteLine(item: PendingImport) {
  if (item.origin || item.destination) return [item.origin, item.destination].filter(Boolean).join(" -> ");
  return item.provider || "Travel booking";
}

function importMetaLine(item: PendingImport) {
  const parts: string[] = [];
  if (item.confirmationCode) parts.push(`Confirmation ${item.confirmationCode}`);
  if (item.flightNumber) parts.push(`Flight ${item.flightNumber}`);
  if (typeof item.overallConfidence === "number" && Number.isFinite(item.overallConfidence)) {
    parts.push(`${Math.round(item.overallConfidence * 100)}% confidence`);
  }
  return parts.join(" · ");
}

const CONNECT_HREF = "/api/integrations/gmail/connect";
const SYNC_HREF = "/api/integrations/gmail/sync";
const DISCONNECT_HREF = "/api/integrations/gmail/disconnect";

export function GmailImportPanel({ tripId, locale }: { tripId: string; locale: RoamlyLocale }) {
  const router = useRouter();
  const [connection, setConnection] = useState<EmailConnectionState | null>(null);
  const [imports, setImports] = useState<PendingImport[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadConnections = useCallback(async () => {
    const response = await fetch("/api/account/email-connections", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) return;
    const gmail = (Array.isArray(data?.connections) ? data.connections : []).find(
      (candidate: EmailConnectionState) => candidate.provider === "gmail"
    );
    setConnection(gmail || null);
  }, []);

  const loadImports = useCallback(async () => {
    const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/bookings/email-imports`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (response.ok) setImports(Array.isArray(data?.imports) ? data.imports : []);
  }, [tripId]);

  useEffect(() => {
    void loadConnections();
    void loadImports();
  }, [loadConnections, loadImports]);

  const connected = connection?.connection_status === "connected" || connection?.connection_status === "syncing";
  const expired = !connected && Boolean(connection?.last_synced_at);

  async function syncNow() {
    setBusy("sync");
    setError("");
    setNotice("");
    try {
      const response = await fetch(SYNC_HREF, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error ? data.error : "We could not sync Gmail right now."
        );
      }
      if (data?.skipped) {
        setNotice("A sync is already running. New bookings will appear here when it finishes.");
      } else {
        const processed = typeof data?.processed === "number" ? data.processed : null;
        setNotice(
          processed === null
            ? "Sync complete. Your inbox was checked for travel confirmations."
            : `Sync complete. ${processed} new email${processed === 1 ? "" : "s"} checked for travel confirmations.`
        );
      }
      await loadConnections();
      await loadImports();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not sync Gmail right now.");
      await loadConnections();
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    setNotice("");
    try {
      const response = await fetch(DISCONNECT_HREF, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Gmail could not be disconnected. Please try again.");
      setConnection(null);
      setNotice(
        "Roamly has stopped syncing Gmail. Bookings already saved to your trips stay put. " +
          (data?.revocationConfirmed
            ? "Google confirmed access was revoked."
            : "Also remove Roamly under your Google Account's Security settings to fully revoke access.")
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gmail could not be disconnected. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function attachImport(importId: string) {
    setBusy(`attach:${importId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/bookings/email-imports/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ extractionId: importId })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error ? data.error : "We could not attach that booking."
        );
      }
      setImports((list) => list.filter((item) => item.id !== importId));
      setNotice("Booking added to your trip.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not attach that booking.");
    } finally {
      setBusy("");
    }
  }

  async function discardImport(importId: string) {
    setBusy(`discard:${importId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/bookings/email-imports/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ extractionId: importId })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error ? data.error : "We could not discard that import."
        );
      }
      setImports((list) => list.filter((item) => item.id !== importId));
      setNotice("Import discarded. The original email is untouched.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not discard that import.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-labelledby="gmail-import-title" className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <div className="mt-6 rounded-2xl border border-ocean/15 bg-white p-4 shadow-[0_10px_36px_rgba(15,118,110,0.08)] sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Email import</p>
        <h2 id="gmail-import-title" className="mt-1 text-xl font-black tracking-tight text-ink">
          Bookings from your inbox
        </h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          Connect Gmail and Roamly finds flight and hotel confirmations in your email. Confident
          matches are added to your bookings automatically; anything uncertain waits for your review below.
          Only travel emails are read; personal mail is never stored.
        </p>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {connected ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black text-ink">{connection?.email_address || "Gmail"} connected</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  Last sync {formatSync(connection?.last_synced_at || null, locale)} · automatic checks run every 30 minutes
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void syncNow()}
                  disabled={Boolean(busy)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy === "sync" ? "Syncing..." : "Sync now"}
                </button>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={Boolean(busy)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-50"
                >
                  {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            </div>
          ) : expired ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold leading-6 text-amber-900">
                Your Gmail connection stopped working. Reconnect to keep importing bookings automatically.
              </p>
              <a
                href={CONNECT_HREF}
                className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white"
              >
                Reconnect Gmail
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-600">No email connected yet.</p>
              <a
                href={CONNECT_HREF}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white"
              >
                Connect Gmail
              </a>
            </div>
          )}
        </div>

        {imports.length ? (
          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">Needs your review</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
              We found these in your email but could not confidently place them. Attach the ones that belong on
              this trip, or discard the rest.
            </p>
            <div className="mt-3 grid gap-2">
              {imports.map((item) => (
                <article key={item.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-ink">{item.title || "Travel booking"}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {importRouteLine(item)} · {importDateLine(item, locale)}
                      </p>
                      {importMetaLine(item) ? (
                        <p className="mt-1 text-xs font-bold text-slate-500">{importMetaLine(item)}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void attachImport(item.id)}
                        disabled={Boolean(busy)}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                      >
                        {busy === `attach:${item.id}` ? "Attaching..." : "Attach to this trip"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void discardImport(item.id)}
                        disabled={Boolean(busy)}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50"
                      >
                        {busy === `discard:${item.id}` ? "Discarding..." : "Discard"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">{error}</p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold leading-6 text-emerald-900">
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}
