"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BuiButton } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import { formatRoamlyDate, type RoamlyLocale } from "@/lib/i18n";
import { closeTravelerSentence } from "@/lib/roamly/itineraryPresentation";

type EmailConnectionState = {
  provider: string;
  email_address: string | null;
  connection_status: string;
  last_synced_at: string | null;
  disconnected_at: string | null;
};

type QuarantinedImport = {
  id: string;
  providerMessageId: string | null;
  subject: string | null;
  reasons: string[];
  createdAt: string | null;
};

type KeptAsideImport = PendingImport & {
  credibilityReasons: string[];
};

const CREDIBILITY_REASON_LABELS: Record<string, string> = {
  missing_confirmation_code: "No confirmation code was found in the email.",
  invalid_confirmation_code: "The code found in the email does not look like a real booking confirmation code.",
  non_booking_sender: "This came from a sender that does not send booking confirmations.",
  promotional_subject: "This looks like a promotional offer, not a booking confirmation.",
  non_booking_notification: "This looks like subscription or notification mail, not a booking confirmation.",
  test_or_qa_record: "This looks like a test record, not a real reservation.",
  missing_provider: "No booking provider could be identified for this email."
};

function credibilityReasonLabel(reason: string) {
  return CREDIBILITY_REASON_LABELS[reason] || "It does not meet the checks for a booking confirmation.";
}

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

const STALE_SYNC_MS = 45 * 60 * 1000;

function syncHonesty(value: string | null, locale: RoamlyLocale) {
  const formatted = formatSync(value, locale);
  if (!value) return `Last sync: not yet. Use Sync now. Roamly is not claiming a fresh inbox.`;
  const parsed = new Date(value).getTime();
  const synced = closeTravelerSentence(`Last sync ${formatted}`);
  if (!Number.isFinite(parsed) || Date.now() - parsed > STALE_SYNC_MS) {
    return `${synced} That check is stale. Use Sync now. Roamly is not claiming a 30-minute refresh.`;
  }
  return synced;
}

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
    parts.push(`${Math.round(item.overallConfidence * 100)}% parse confidence`);
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
  const [keptAside, setKeptAside] = useState<KeptAsideImport[]>([]);
  const [quarantined, setQuarantined] = useState<QuarantinedImport[]>([]);
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
    if (response.ok) {
      setImports(Array.isArray(data?.imports) ? data.imports : []);
      setKeptAside(Array.isArray(data?.keptAside) ? data.keptAside : []);
      setQuarantined(Array.isArray(data?.quarantined) ? data.quarantined : []);
    }
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
      setImports((list: PendingImport[]) => list.filter((item: PendingImport) => item.id !== importId));
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
      setImports((list: PendingImport[]) => list.filter((item: PendingImport) => item.id !== importId));
      setNotice("Import discarded. The original email is untouched.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not discard that import.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-labelledby="gmail-import-title" className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <BuiCard className="bui-enter mt-6 p-4 sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Email import</p>
        <h2 id="gmail-import-title" className="mt-1 text-xl font-black tracking-tight text-ink">
          Bookings from your inbox
        </h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          Connect Gmail and Roamly finds flight and hotel confirmations in your email. Confident
          matches are added to your bookings automatically; anything uncertain waits for your review below.
          Only travel emails are read; personal mail is never stored.
        </p>

        <div className="mt-4 rounded-bui-card border border-chair bg-cbg p-4">
          {/* The recon state line (owner wording law): the connection
              state reads exactly "activated" / "not activated" — one
              quiet line, no internal vocabulary. A disconnected or
              expired connection is "not activated", same as the trip
              page's state line and the setup cascade. */}
          <p className="mb-3 text-sm font-semibold text-slate-600">
            Booking Recon: <span className="font-black text-ink">{connected ? "activated" : "not activated"}</span>
          </p>
          {connected ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black text-ink">{connection?.email_address || "Gmail"} connected</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {syncHonesty(connection?.last_synced_at || null, locale)}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <BuiButton type="button" onClick={() => void syncNow()} disabled={Boolean(busy)} busy={busy === "sync"}>
                  {busy === "sync" ? "Syncing..." : "Sync now"}
                </BuiButton>
                <BuiButton
                  type="button"
                  variant="secondary"
                  onClick={() => void disconnect()}
                  disabled={Boolean(busy)}
                  busy={busy === "disconnect"}
                >
                  {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </BuiButton>
              </div>
            </div>
          ) : expired ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-bui-card border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold leading-6 text-amber-900">
                Your Gmail connection stopped working. Reconnect to keep importing bookings automatically.
              </p>
              <a
                href={CONNECT_HREF}
                className="bui-press bui-touch inline-flex min-h-11 w-fit items-center justify-center rounded-xl bg-cblue px-4 py-2 text-sm font-black text-white shadow-[0_8px_20px_rgba(8,123,255,0.25)]"
              >
                Reconnect Gmail
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-600">No email connected yet.</p>
              <a
                href={CONNECT_HREF}
                className="bui-press bui-touch inline-flex min-h-11 items-center justify-center rounded-xl bg-cblue px-4 py-2 text-sm font-black text-white shadow-[0_8px_20px_rgba(8,123,255,0.25)]"
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
              {imports.map((item: PendingImport) => (
                <article key={item.id} className="bui-enter bui-lift rounded-bui-card border border-amber-200 bg-amber-50/50 p-3">
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
                      <BuiButton
                        type="button"
                        size="small"
                        onClick={() => void attachImport(item.id)}
                        disabled={Boolean(busy)}
                        busy={busy === `attach:${item.id}`}
                      >
                        {busy === `attach:${item.id}` ? "Attaching..." : "Attach to this trip"}
                      </BuiButton>
                      <BuiButton
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => void discardImport(item.id)}
                        disabled={Boolean(busy)}
                        busy={busy === `discard:${item.id}`}
                      >
                        {busy === `discard:${item.id}` ? "Discarding..." : "Discard"}
                      </BuiButton>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {keptAside.length ? (
          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
              Kept aside — these don&apos;t look like booking confirmations
            </p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
              Roamly read these emails again with stricter checks and they do not pass as booking
              confirmations, so they can&apos;t be attached to a trip. They are kept here for your
              records — nothing was deleted, and the original emails are untouched.
            </p>
            <div className="mt-3 grid gap-2">
              {keptAside.map((item: KeptAsideImport) => (
                <article key={item.id} className="rounded-bui-card border border-chair bg-cbg p-3">
                  <p className="text-sm font-black text-ink">{item.title || "Email kept aside"}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {importRouteLine(item)} · {importDateLine(item, locale)}
                  </p>
                  {(item.credibilityReasons || []).map((reason: string) => (
                    <p key={reason} className="mt-1 text-xs font-bold text-slate-500">
                      {credibilityReasonLabel(reason)}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {quarantined.length ? (
          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Kept aside, not deleted</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
              These emails could not be read during a sync, so they were kept aside instead of blocking
              your other mail. They are retried the next time Gmail is reconnected; nothing here was deleted.
            </p>
            <div className="mt-3 grid gap-2">
              {quarantined.map((item: QuarantinedImport) => (
                <article key={item.id} className="rounded-bui-card border border-chair bg-cbg p-3">
                  <p className="text-sm font-black text-ink">{item.subject || "Email kept aside"}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    Could not be read during sync — kept aside for a later retry.
                  </p>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <BuiNotice tone="error" title={error} className="mt-3" /> : null}
        {notice ? <BuiNotice tone="success" title={notice} className="mt-3" /> : null}
      </BuiCard>
    </section>
  );
}
