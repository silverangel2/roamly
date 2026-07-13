"use client";

import { useState } from "react";

type Settings = {
  automationEnabled: boolean;
  paused: boolean;
  postsPerDay: number;
  reelsPerWeek: number;
  preferredPostingHours: number[];
  timeZone: string;
  minimumQueueSize: number;
  maximumQueueSize: number;
  maximumDailyPosts: number;
  affiliatePostFrequency: number;
  promotionalPostFrequency: number;
  websiteLinkFrequency: number;
  statementPostFrequency: number;
  automaticRetryLimit: number;
  media: {
    maximumUsesPerAsset: number;
    minimumDaysBeforeReuse: number;
    preferNewestUploads: boolean;
    allowGeneratedVisuals: boolean;
    allowStatementGraphics: boolean;
    allowStockFallbackMedia: boolean;
  };
};

type ControlSummary = {
  tableReady: boolean;
  settings: Settings;
  env: {
    publishingReady: boolean;
    facebookConnected: boolean;
    pageName?: string;
    pageId?: string;
    blockingIssues: string[];
  };
  counts: {
    queueSize: number;
    scheduled: number;
    published: number;
    failed: number;
    retrying: number;
  };
};

type ActionButton = {
  action: string;
  label: string;
  confirm?: string;
  disabled?: boolean;
};

export function FacebookAutomationControls({ summary }: { summary: ControlSummary }) {
  const [settings, setSettings] = useState(summary.settings);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function runAction(action: string, confirmMessage?: string) {
    setNotice("");
    setError("");

    const confirmed = confirmMessage ? window.confirm(confirmMessage) : true;
    if (!confirmed) return;

    setBusy(action);
    try {
      const response = await fetch("/api/admin/roamly/social/automation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, confirm: Boolean(confirmMessage) })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || data?.reason || "Automation action failed.");
      setNotice(data?.reason || data?.status || data?.result?.status || "Action completed.");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automation action failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    const confirmHighDailyLimit = settings.maximumDailyPosts > 6;
    if (confirmHighDailyLimit && !window.confirm("This is a high daily posting limit. Save it anyway?")) return;

    setBusy("save_settings");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/roamly/social/automation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save_settings", settings, confirm: confirmHighDailyLimit })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Settings could not be saved.");
      setNotice("Automation settings saved.");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settings could not be saved.");
    } finally {
      setBusy("");
    }
  }

  function updateNumber(key: keyof Settings, value: string) {
    setSettings((current) => ({ ...current, [key]: Number(value) }));
  }

  function updateHours(value: string) {
    const hours = value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item >= 0 && item <= 23);
    setSettings((current) => ({ ...current, preferredPostingHours: hours.length ? [...new Set(hours)] : current.preferredPostingHours }));
  }

  const actions: ActionButton[] = [
    {
      action: "enable_autopost",
      label: "Enable autopost",
      confirm: "Enable unattended Facebook autoposting? Only do this after the Page and token are validated.",
      disabled: summary.settings.automationEnabled && !summary.settings.paused
    },
    {
      action: summary.settings.paused ? "resume" : "pause",
      label: summary.settings.paused ? "Resume autopost" : "Pause autopost"
    },
    {
      action: "generate_100",
      label: "Generate 100 posts",
      confirm: "Create 100 unique scheduled Facebook posts and Reels?"
    },
    { action: "refill_queue", label: "Refill queue" },
    {
      action: "publish_next_now",
      label: "Publish next now",
      confirm: "Publish the next scheduled Facebook item immediately?"
    },
    { action: "run_automation", label: "Run automation now" },
    { action: "retry_failures", label: "Retry failures" },
    { action: "skip_next", label: "Skip next post" },
    {
      action: "clear_failed_jobs",
      label: "Clear failed jobs",
      confirm: "Archive all failed jobs and mark failure records resolved?"
    }
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-2xl border border-cloud bg-white/92 p-4 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Controls</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {actions.map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => runAction(item.action, item.confirm)}
              disabled={Boolean(busy) || item.disabled || !summary.tableReady}
              className="rounded-xl bg-ink px-4 py-3 text-sm font-black text-white shadow-soft transition hover:bg-ocean disabled:cursor-not-allowed disabled:bg-slate-300"
              title={!summary.tableReady ? "Run the database migration first." : undefined}
            >
              {busy === item.action ? "Working..." : item.label}
            </button>
          ))}
        </div>
        {summary.env.blockingIssues.length ? (
          <div className="mt-4 rounded-xl bg-sun/15 px-4 py-3 text-sm font-bold leading-6 text-amber-900">
            {summary.env.blockingIssues[0]}
          </div>
        ) : null}
        {notice ? <p className="mt-4 rounded-xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
        {error ? <p className="mt-4 rounded-xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-cloud bg-white/92 p-4 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Automation settings</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            ["Posts per day", "postsPerDay", 0, 12],
            ["Reels per week", "reelsPerWeek", 0, 21],
            ["Minimum queue", "minimumQueueSize", 0, 500],
            ["Maximum queue", "maximumQueueSize", 1, 1000],
            ["Maximum daily posts", "maximumDailyPosts", 0, 24],
            ["Retry limit", "automaticRetryLimit", 0, 10]
          ].map(([label, key, min, max]) => (
            <label key={String(key)} className="block">
              <span className="text-sm font-black text-ink">{label}</span>
              <input
                type="number"
                min={Number(min)}
                max={Number(max)}
                value={settings[key as keyof Settings] as number}
                onChange={(event) => updateNumber(key as keyof Settings, event.target.value)}
                className="mt-2 w-full rounded-xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-sm font-black text-ink">Preferred hours</span>
            <input
              value={settings.preferredPostingHours.join(", ")}
              onChange={(event) => updateHours(event.target.value)}
              className="mt-2 w-full rounded-xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
            />
          </label>
          <label className="block">
            <span className="text-sm font-black text-ink">Time zone</span>
            <input
              value={settings.timeZone}
              onChange={(event) => setSettings((current) => ({ ...current, timeZone: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
            />
          </label>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer rounded-xl bg-mist px-4 py-3 text-sm font-black text-ink">Advanced media settings</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              ["Prefer newest uploads", "preferNewestUploads"],
              ["Allow generated visuals", "allowGeneratedVisuals"],
              ["Allow statement graphics", "allowStatementGraphics"],
              ["Allow fallback media", "allowStockFallbackMedia"]
            ].map(([label, key]) => (
              <label key={key} className="flex items-center gap-3 rounded-xl bg-mist px-4 py-3 text-sm font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(settings.media[key as keyof Settings["media"]])}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, media: { ...current.media, [key]: event.target.checked } }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </details>
        <button
          type="button"
          onClick={saveSettings}
          disabled={Boolean(busy) || !summary.tableReady}
          className="mt-5 rounded-xl bg-ocean px-5 py-3 text-sm font-black text-white shadow-soft disabled:bg-slate-300"
        >
          {busy === "save_settings" ? "Saving..." : "Save settings"}
        </button>
      </section>
    </div>
  );
}
