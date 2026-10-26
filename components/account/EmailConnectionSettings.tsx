"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatRoamlyDate } from "@/lib/i18n";
import { gmailSyncFailureAction, isGmailSyncPersistentlyFailing } from "@/lib/roamly/emailSyncHealth";

type EmailConnection = {
  provider: "gmail";
  email_address: string | null;
  connection_status: string;
  last_synced_at: string | null;
  last_sync_error_code?: string | null;
  last_sync_failed_at?: string | null;
};

/**
 * Autosync: a manual sync returns a machine code, never words. The traveler
 * sees plain words instead — the raw code never renders as a badge.
 */
function plainSyncError(message: string): string {
  if (message.includes("GMAIL_TOKEN_REFRESH_RETRY")) {
    return "Gmail couldn't refresh its connection. Try Sync again, or reconnect Gmail if this keeps happening.";
  }
  if (message.includes("GMAIL_REAUTH_REQUIRED")) {
    return "Gmail needs to be reconnected — use Connect Gmail below.";
  }
  if (
    message.includes("GMAIL_BACKFILL_SEARCH_FAILED") ||
    message.includes("GMAIL_BACKFILL_TOKEN_FAILED") ||
    message.includes("GMAIL_BACKFILL_PROCESSING_RETRY")
  ) {
    return "We couldn't search your older mail right now. Your saved trips are safe — try again later.";
  }
  return message;
}

const PROVIDERS = [
  {
    provider: "gmail" as const,
    name: "Gmail",
    connectPath: "/api/integrations/gmail/connect",
    syncPath: "/api/integrations/gmail/sync",
    searchOlderPath: "/api/integrations/gmail/search-older",
    disconnectPath: "/api/integrations/gmail/disconnect",
    connectLabel: "Connect Gmail",
    syncLabel: "Sync Gmail",
    searchOlderLabel: "Search older mail",
    disconnectLabel: "Disconnect Gmail"
  }
];

function formatSync(value: string | null, locale: Parameters<typeof formatRoamlyDate>[1]) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return formatRoamlyDate(date, locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function EmailConnectionSettings() {
  const { locale, t } = useI18n();
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const connectionByProvider = useMemo(
    () => new Map(connections.map((connection) => [connection.provider, connection])),
    [connections]
  );

  async function load() {
    const response = await fetch("/api/account/email-connections", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (response.ok) setConnections(data.connections || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function post(url: string, action: string, providerName: string) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || `We could not update ${providerName} right now.`);
      if (action.endsWith(":disconnect")) {
        const warnings = [
          data?.pushStopped ? "Gmail push notifications have been stopped." : "We could not confirm that Gmail push notifications stopped.",
          data?.revocationConfirmed ? "Google confirmed access was revoked." : "Google could not confirm access revocation; remove Roamly under your Google Account’s Security → Connections settings."
        ];
        setNotice(`Roamly has stopped syncing Gmail. ${warnings.join(" ")}`);
      }
      if (action.endsWith(":search-older")) {
        const checked = typeof data?.processed === "number" ? data.processed : 0;
        const scanned = typeof data?.scanned === "number" ? data.scanned : checked;
        const skipped = typeof data?.skipped === "number" && data.skipped > 0 ? `, ${data.skipped} already seen` : "";
        const keptAside = typeof data?.quarantined === "number" && data.quarantined > 0 ? `, ${data.quarantined} kept aside` : "";
        setNotice(
          `Searched your mail from the last 90 days: ${scanned} message${scanned === 1 ? "" : "s"} found, ${checked} checked${skipped}${keptAside}. Anything found is on your trips, or in a trip's email imports for review.`
        );
      }
      await load();
    } catch (err) {
      setError(plainSyncError(err instanceof Error ? err.message : `We could not update ${providerName} right now.`));
    } finally {
      setBusy("");
    }
  }

  return (
    <div id="email-settings" className="space-y-4 scroll-mt-24">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-black text-ink">Travel email import</p>
        <p className="mt-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold leading-6 text-teal-950">
          {t("ui.email.importGmailOnly", "Gmail is the only email provider Roamly supports right now. Outlook and other email providers can’t be connected yet.")}
        </p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
          Connect Gmail so Roamly can find travel confirmations and changes. Only messages the travel filter identifies are saved as limited message details and booking facts; full email bodies are not stored. A short preview from a matching message may be sent to OpenAI to extract booking details. Personal emails are not saved or used for advertising. Messages that do not match the travel filter are skipped. Disconnecting stops future syncs but does not remove booking details already saved to a trip.
        </p>
      </div>

      <div className="grid gap-3">
        {PROVIDERS.map((provider) => {
          const connection = connectionByProvider.get(provider.provider);
          // Autosync: an "error" row is a failed attempt, not a dead
          // connection — the monitor retries it, so it still reads as
          // connected here, exactly like the gate view. Only a PERSISTENT
          // failure (error + last success over 24h old) names itself and
          // offers the reconnect; a transient failure never pushes one.
          const connected =
            connection?.connection_status === "connected" ||
            connection?.connection_status === "syncing" ||
            connection?.connection_status === "error";
          const failing = isGmailSyncPersistentlyFailing({
            connectionStatus: connection?.connection_status ?? null,
            lastSyncedAt: connection?.last_synced_at ?? null
          });
          const failureAction = gmailSyncFailureAction(connection?.last_sync_error_code ?? null);
          const failureLine = failing
            ? failureAction === "reconnect"
              ? `Gmail sync hasn't worked since ${formatSync(connection?.last_synced_at || null, locale)} — reconnect Gmail`
              : `Gmail sync hasn't worked since ${formatSync(connection?.last_synced_at || null, locale)} — try Sync Gmail again`
            : null;
          const syncBusy = busy === `${provider.provider}:sync`;
          const searchOlderBusy = busy === `${provider.provider}:search-older`;
          const disconnectBusy = busy === `${provider.provider}:disconnect`;
          return (
            <div key={provider.provider} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-black text-ink">{provider.name}</p>
              <p className="mt-2 text-sm font-bold text-slate-500">
                {connected
                  ? `${connection?.email_address || provider.name} connected · Last sync ${formatSync(connection?.last_synced_at || null, locale)}`
                  : "Not connected"}
              </p>
              {failureLine ? (
                <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold leading-6 text-amber-900">
                  {failureLine}
                </p>
              ) : null}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {connected && !failing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void post(provider.syncPath, `${provider.provider}:sync`, provider.name)}
                      disabled={Boolean(busy)}
                      className="min-h-12 rounded-2xl bg-ocean px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      {syncBusy ? "Syncing..." : provider.syncLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void post(provider.searchOlderPath, `${provider.provider}:search-older`, provider.name)}
                      disabled={Boolean(busy)}
                      className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-ink disabled:opacity-50"
                    >
                      {searchOlderBusy ? "Searching..." : provider.searchOlderLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void post(provider.disconnectPath, `${provider.provider}:disconnect`, provider.name)}
                      disabled={Boolean(busy)}
                      className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-ink disabled:opacity-50"
                    >
                      {disconnectBusy ? "Disconnecting..." : provider.disconnectLabel}
                    </button>
                  </>
                ) : failing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void post(provider.syncPath, `${provider.provider}:sync`, provider.name)}
                      disabled={Boolean(busy)}
                      className="min-h-12 rounded-2xl bg-ocean px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      {syncBusy ? "Syncing..." : provider.syncLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void post(provider.searchOlderPath, `${provider.provider}:search-older`, provider.name)}
                      disabled={Boolean(busy)}
                      className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-ink disabled:opacity-50"
                    >
                      {searchOlderBusy ? "Searching..." : provider.searchOlderLabel}
                    </button>
                    <a
                      href={provider.connectPath}
                      className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-ink"
                    >
                      {failureAction === "reconnect" ? "Reconnect Gmail" : provider.connectLabel}
                    </a>
                    <button
                      type="button"
                      onClick={() => void post(provider.disconnectPath, `${provider.provider}:disconnect`, provider.name)}
                      disabled={Boolean(busy)}
                      className="min-h-12 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-ink disabled:opacity-50"
                    >
                      {disconnectBusy ? "Disconnecting..." : provider.disconnectLabel}
                    </button>
                  </>
                ) : (
                  <a
                    href={provider.connectPath}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-ocean px-5 py-3 text-sm font-black text-white"
                  >
                    {provider.connectLabel}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900">{notice}</p> : null}
    </div>
  );
}
