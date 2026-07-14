"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

type EmailLog = {
  id: string;
  to_email: string;
  subject: string;
  provider: string | null;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  last_error?: string | null;
  template?: string | null;
  attempt_count?: number | null;
  trip_id?: string | null;
  created_at: string;
  sent_at: string | null;
};

type RetryTrip = {
  id: string;
  title: string | null;
  destination_name?: string | null;
  completion_email_status: string | null;
  completion_email_attempt_count: number | null;
  completion_email_next_retry_at: string | null;
  completion_email_last_error: string | null;
};

type EmailConfig = {
  configured: boolean;
  provider: string;
  activeProviderLabel: string;
  supportEmail: string;
  fromEmail: string;
  replyToEmail: string;
  reason: string;
  missingVariables: string[];
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpAuthenticationStatus: string;
  logoUrl: string;
};

type VerificationResult = {
  ok: boolean;
  checkedAt: string;
  status: string;
  message: string;
  checks: Array<{ label: string; status: string; detail?: string }>;
};

type Preview = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

const previewTemplates = [
  ["itinerary_ready", "Itinerary ready"],
  ["welcome", "Welcome"],
  ["support_notification", "Support"],
  ["contact_confirmation", "Contact"],
  ["login_help", "Login help"],
  ["trip_reminder", "Trip reminder"],
  ["itinerary_generation_failure", "Generation failure"],
  ["facebook_autopost_failure", "Facebook failure"],
  ["weekly_automation_report", "Weekly report"],
  ["billing_notification", "Billing"],
  ["feature_announcement", "Feature"],
  ["admin_test_email", "Admin test"]
];

function statusClass(status: string) {
  if (status === "sent" || status === "Ready") return "bg-ocean/10 text-ocean";
  if (status === "failed" || status.includes("failed") || status.includes("invalid") || status.includes("Missing")) return "bg-coral/10 text-coral";
  return "bg-sun/20 text-amber-800";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "None";
}

export function AdminEmailConsole({
  adminEmail,
  emailConfig,
  initialLogs,
  retryQueue
}: {
  adminEmail: string;
  emailConfig: EmailConfig;
  initialLogs: EmailLog[];
  retryQueue: RetryTrip[];
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [queue, setQueue] = useState(retryQueue);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [template, setTemplate] = useState("itinerary_ready");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile" | "html" | "text">("desktop");

  const missingConfig = useMemo(
    () => emailConfig.missingVariables.length ? emailConfig.missingVariables.join(", ") : emailConfig.configured ? "None" : emailConfig.reason,
    [emailConfig]
  );

  async function refreshLogs() {
    const response = await fetchWithSupabaseAuth("/api/admin/roamly/email/logs", { credentials: "include" });
    const data = await response.json().catch(() => null);
    if (response.ok && Array.isArray(data?.logs)) setLogs(data.logs);
  }

  async function loadPreview(nextTemplate = template) {
    setBusy("preview");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/email/preview", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: nextTemplate })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Preview failed.");
      setPreview(data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setBusy("");
    }
  }

  async function verifySmtp() {
    setBusy("verify");
    setNotice("");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/email/verify", {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json().catch(() => null);
      if (!response.ok && !data?.result) throw new Error(data?.error || "SMTP verification failed.");
      setVerification(data.result);
      setNotice(data.result?.message || "SMTP verification complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "SMTP verification failed.");
    } finally {
      setBusy("");
    }
  }

  async function sendTest() {
    setBusy("test");
    setNotice("");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/email/test", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => null);
      if (!response.ok && response.status !== 202) throw new Error(data?.error || data?.result?.error || "Test email failed.");
      setNotice(data?.result?.providerMessageId ? `Test email sent. Message ID: ${data.result.providerMessageId}` : "Test email processed.");
      await refreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test email failed.");
    } finally {
      setBusy("");
    }
  }

  async function retryEmail(payload: { logId?: string; tripId?: string }) {
    const key = payload.logId || payload.tripId || "retry";
    setBusy(key);
    setNotice("");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/email/retry", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok && response.status !== 202) throw new Error(data?.error || data?.result?.error || "Retry failed.");
      setNotice(data?.result?.status === "skipped" ? data.result.error || "Retry skipped." : "Retry processed.");
      await refreshLogs();
      setQueue((current) => current.filter((item) => item.id !== payload.tripId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    loadPreview("itinerary_ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
      <section className="grid gap-5">
        <div className="rounded-[1.25rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Provider</p>
              <h2 className="mt-2 text-2xl font-black text-ink">{emailConfig.activeProviderLabel}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{emailConfig.smtpUser || adminEmail}</p>
            </div>
            <span className={`w-fit rounded-full px-3 py-2 text-xs font-black ${statusClass(emailConfig.configured ? "Ready" : "Missing")}`}>
              {emailConfig.configured ? "Configured" : "Needs setup"}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ["SMTP host", emailConfig.smtpHost || "Missing"],
              ["SMTP port", emailConfig.smtpPort ? `${emailConfig.smtpPort}` : "Missing"],
              ["Secure", emailConfig.smtpSecure ? "true" : "false"],
              ["From", emailConfig.fromEmail],
              ["Reply-to", emailConfig.replyToEmail],
              ["Missing", missingConfig],
              ["Last verification", verification?.checkedAt ? formatDate(verification.checkedAt) : "Not verified this session"],
              ["Authentication", verification?.checks.find((check) => check.label === "Authentication")?.status || emailConfig.smtpAuthenticationStatus]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-mist px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                <p className="mt-1 break-words text-sm font-black leading-6 text-ink">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={verifySmtp}
              disabled={Boolean(busy)}
              className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud disabled:opacity-60"
            >
              {busy === "verify" ? "Verifying..." : "Verify SMTP connection"}
            </button>
            <button
              type="button"
              onClick={sendTest}
              disabled={Boolean(busy)}
              className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft disabled:opacity-60"
            >
              {busy === "test" ? "Sending..." : "Send test email to admin"}
            </button>
          </div>

          {verification ? (
            <div className="mt-5 grid gap-2">
              {verification.checks.map((check) => (
                <div key={check.label} className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-cloud">
                  <p className="text-sm font-black text-ink">{check.label}</p>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(check.status)}`}>{check.status}</span>
                </div>
              ))}
            </div>
          ) : null}

          {notice ? <p className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
          {error ? <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
        </div>

        <div className="rounded-[1.25rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Retry queue</p>
              <h2 className="mt-2 text-xl font-black text-ink">Completion emails</h2>
            </div>
            <button
              type="button"
              onClick={refreshLogs}
              className="rounded-2xl bg-white px-4 py-3 text-xs font-black text-ink shadow-soft ring-1 ring-cloud"
            >
              View delivery history
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {queue.map((trip) => (
              <article key={trip.id} className="rounded-2xl bg-mist px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-ink">{trip.title || trip.destination_name || trip.id}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {trip.completion_email_status || "pending"} · attempts {trip.completion_email_attempt_count || 0} · next {formatDate(trip.completion_email_next_retry_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => retryEmail({ tripId: trip.id })}
                    disabled={Boolean(busy)}
                    className="rounded-xl bg-ink px-4 py-2 text-xs font-black text-white disabled:opacity-60"
                  >
                    {busy === trip.id ? "Retrying..." : "Retry failed email"}
                  </button>
                </div>
                {trip.completion_email_last_error ? <p className="mt-2 text-xs font-black text-coral">{trip.completion_email_last_error}</p> : null}
              </article>
            ))}
            {!queue.length ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No completion-email retries queued.</p> : null}
          </div>
        </div>
      </section>

      <section className="grid gap-5">
        <div className="rounded-[1.25rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Preview</p>
              <h2 className="mt-2 text-2xl font-black text-ink">Production renderer</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-[220px_auto]">
              <select
                value={template}
                onChange={(event) => {
                  setTemplate(event.target.value);
                  loadPreview(event.target.value);
                }}
                className="rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
              >
                {previewTemplates.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadPreview(template)}
                disabled={Boolean(busy)}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud disabled:opacity-60"
              >
                {busy === "preview" ? "Loading..." : "View email template"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["itinerary_ready", "Preview itinerary-ready email"],
              ["welcome", "Preview welcome email"],
              ["support_notification", "Preview support email"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTemplate(value);
                  loadPreview(value);
                }}
                className="rounded-full bg-mist px-4 py-2 text-xs font-black text-ink"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["desktop", "Desktop preview"],
              ["mobile", "Mobile preview"],
              ["html", "HTML preview"],
              ["text", "Plain-text preview"]
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPreviewMode(mode as typeof previewMode)}
                className={`rounded-full px-4 py-2 text-xs font-black ${previewMode === mode ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-cloud"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-2xl bg-mist p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Subject preview</p>
            <p className="mt-2 break-words text-sm font-black text-ink">{preview?.subject || "Loading preview..."}</p>
          </div>

          {previewMode === "html" ? (
            <pre className="mt-4 max-h-[620px] overflow-auto rounded-2xl bg-ink p-4 text-xs leading-5 text-white">{preview?.html || ""}</pre>
          ) : previewMode === "text" ? (
            <pre className="mt-4 max-h-[620px] overflow-auto whitespace-pre-wrap rounded-2xl bg-white p-4 text-sm leading-6 text-ink ring-1 ring-cloud">{preview?.text || ""}</pre>
          ) : (
            <div className="mt-4 overflow-auto rounded-2xl bg-slate-200 p-4">
              <iframe
                title={`${template} ${previewMode} email preview`}
                srcDoc={preview?.html || ""}
                className={`mx-auto min-h-[720px] border-0 bg-white ${previewMode === "mobile" ? "w-[375px] max-w-full" : "w-[640px] max-w-full"}`}
              />
            </div>
          )}
        </div>

        <div className="rounded-[1.25rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Recent delivery logs</p>
          <div className="mt-4 grid gap-3">
            {logs.map((log) => (
              <article key={log.id} className="rounded-2xl bg-mist px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="break-words text-sm font-black text-ink">{log.subject}</p>
                    <p className="mt-1 break-words text-xs font-bold text-slate-500">
                      {log.to_email} · {log.provider || "provider missing"} · {log.template || "transactional"} · attempts {log.attempt_count || 1}
                    </p>
                    <p className="mt-1 break-words text-xs font-bold text-slate-500">
                      Message ID: {log.provider_message_id || "None"} · Created {formatDate(log.created_at)}
                    </p>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${statusClass(log.status)}`}>{log.status}</span>
                </div>
                {log.error || log.last_error ? <p className="mt-2 text-xs font-black text-coral">{log.error || log.last_error}</p> : null}
                {log.status === "failed" && log.trip_id ? (
                  <button
                    type="button"
                    onClick={() => retryEmail({ logId: log.id })}
                    disabled={Boolean(busy)}
                    className="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-black text-ink shadow-soft ring-1 ring-cloud disabled:opacity-60"
                  >
                    {busy === log.id ? "Retrying..." : "Retry failed email"}
                  </button>
                ) : null}
              </article>
            ))}
            {!logs.length ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No email logs yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
