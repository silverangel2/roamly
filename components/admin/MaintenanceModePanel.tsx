"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";

type MaintenanceState = {
  enabled: boolean;
  updatedAt: string | null;
  configured: boolean;
};

export function MaintenanceModePanel() {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/admin/roamly/maintenance", { credentials: "include" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || `Load failed (HTTP ${response.status}).`);
      setState(data.maintenance as MaintenanceState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the maintenance state.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function flip(enabled: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/roamly/maintenance", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || `Update failed (HTTP ${response.status}).`);
      setState(data.maintenance as MaintenanceState);
      setNotice(
        enabled
          ? "Maintenance is ON. Public pages now show the maintenance page; the change reaches every visitor within about 10 seconds."
          : "Maintenance is OFF. The public site is live again; the change reaches every visitor within about 10 seconds."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <p className="text-sm font-bold leading-6 text-slate-600">
        Current state:{" "}
        <span className="font-black text-ink">
          {state === null ? "Loading…" : state.enabled ? "ON — public pages show the maintenance page" : "OFF — site is live"}
        </span>
      </p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        While maintenance is on, admin, cron jobs, APIs and the daily-test seams keep working, and
        travelers who are already signed in can still view their existing trips. New itinerary
        building is paused because the public planner shows the maintenance page instead.
      </p>
      {state?.updatedAt ? (
        <p className="mt-2 text-xs font-bold text-slate-500">Last changed: {state.updatedAt}</p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void flip(true)}
          disabled={busy || state === null || state.enabled}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-coral px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Turn maintenance ON"}
        </button>
        <button
          type="button"
          onClick={() => void flip(false)}
          disabled={busy || state === null || !state.enabled}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-ocean px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Turn maintenance OFF — back live"}
        </button>
      </div>
    </Card>
  );
}
