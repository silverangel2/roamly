"use client";

import { useState } from "react";

type EmailLog = {
  id: string;
  to_email: string;
  subject: string;
  provider: string | null;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
};

const templates = [
  "general_admin_message",
  "beta_invite",
  "trip_reminder",
  "live_trip_companion_reminder",
  "support_reply"
];

export function AdminEmailConsole({
  adminEmail,
  initialLogs
}: {
  adminEmail: string;
  initialLogs: EmailLog[];
}) {
  const [to, setTo] = useState(adminEmail);
  const [subject, setSubject] = useState("Roamly update");
  const [message, setMessage] = useState("Hi, this is a Roamly update from the admin team.");
  const [template, setTemplate] = useState("general_admin_message");
  const [logs, setLogs] = useState(initialLogs);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refreshLogs() {
    const response = await fetch("/api/admin/roamly/email/logs");
    const data = await response.json().catch(() => null);
    if (response.ok && Array.isArray(data?.logs)) setLogs(data.logs);
  }

  async function send(mode: "test" | "email") {
    setBusy(mode);
    setNotice("");
    setError("");
    const endpoint = mode === "test" ? "/api/admin/roamly/email/test" : "/api/admin/roamly/email/send";
    const payload = mode === "test" ? { to } : { to, subject, message, template };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok && response.status !== 202) throw new Error(data?.error || data?.result?.error || "Email send failed.");
      setNotice(data?.result?.status === "skipped" ? data.result.error || "Email skipped." : "Email request processed.");
      await refreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Email send failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Composer</p>
        <div className="mt-4 grid gap-4">
          <label className="block">
            <span className="text-sm font-black text-ink">To</span>
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              type="email"
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
            />
          </label>
          <label className="block">
            <span className="text-sm font-black text-ink">Template</span>
            <select
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
            >
              {templates.map((item) => (
                <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-black text-ink">Subject</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
            />
          </label>
          <label className="block">
            <span className="text-sm font-black text-ink">Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={7}
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold leading-6 outline-none focus:border-ocean"
            />
          </label>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => send("test")}
            disabled={Boolean(busy)}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud disabled:opacity-60"
          >
            {busy === "test" ? "Sending..." : "Send test"}
          </button>
          <button
            type="button"
            onClick={() => send("email")}
            disabled={Boolean(busy)}
            className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft disabled:opacity-60"
          >
            {busy === "email" ? "Sending..." : "Send email"}
          </button>
        </div>
        {notice ? <p className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
        {error ? <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
      </section>

      <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Recent email logs</p>
        <div className="mt-4 grid gap-3">
          {logs.map((log) => (
            <article key={log.id} className="rounded-2xl bg-mist px-4 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-black text-ink">{log.subject}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${log.status === "sent" ? "bg-ocean/10 text-ocean" : log.status === "failed" ? "bg-coral/10 text-coral" : "bg-sun/15 text-amber-800"}`}>
                  {log.status}
                </span>
              </div>
              <p className="mt-1 break-words text-xs font-bold text-slate-500">{log.to_email} · {log.provider || "provider missing"}</p>
              {log.error ? <p className="mt-2 text-xs font-black text-coral">{log.error}</p> : null}
            </article>
          ))}
          {!logs.length ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No email logs yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
