"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";

type ProvisionResult = {
  claimCode: string;
  expiresAt: string;
  userId: string;
  email: string;
  created: boolean;
  rotated: boolean;
};

export function DailyTestProvisionPanel({
  provisioningEnabled,
  testEmail
}: {
  provisioningEnabled: boolean;
  testEmail: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [error, setError] = useState("");

  async function provision() {
    setBusy(true);
    setResult(null);
    setError("");

    try {
      const response = await fetch("/api/admin/roamly/provision-daily-test", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Provisioning failed (HTTP ${response.status}).`);
      }
      setResult({
        claimCode: String(data.claimCode || ""),
        expiresAt: String(data.expiresAt || ""),
        userId: String(data.userId || ""),
        email: String(data.email || ""),
        created: Boolean(data.created),
        rotated: Boolean(data.rotated)
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provisioning failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <p className="text-sm font-bold leading-6 text-slate-600">
        Account: <span className="font-black text-ink">{testEmail}</span>
      </p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        Clicking the button creates the account on first use and rotates its password on every
        later use. It returns a one-time claim code (valid 15 minutes, usable exactly once) for
        the automation to exchange for the password directly — the password itself is never
        shown here.
      </p>

      {!provisioningEnabled ? (
        <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          Provisioning is disabled: ROAMLY_DAILY_TEST_PROVISIONING is off, so the button is
          inert. Turn the flag on in the deployment environment to provision or rotate.
        </p>
      ) : null}

      <button
        type="button"
        onClick={provision}
        disabled={busy || !provisioningEnabled}
        className="mt-4 rounded-2xl bg-ink px-4 py-3 text-sm font-black text-white shadow-soft transition hover:bg-ocean disabled:opacity-60"
      >
        {busy ? "Provisioning..." : "Provision daily test account"}
      </button>

      {result ? (
        <div className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3">
          <p className="text-sm font-black text-ocean">
            {result.created ? "Account created." : "Account rotated."} Claim code — hand it to
            the automation within 15 minutes; it can be used exactly once:
          </p>
          <p className="mt-2 break-all rounded-xl bg-white px-3 py-2 font-mono text-sm font-bold text-ink">
            {result.claimCode}
          </p>
          <p className="mt-2 text-xs font-bold leading-5 text-slate-600">
            Expires: {result.expiresAt} · User: {result.userId} · Email: {result.email}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p>
      ) : null}
    </Card>
  );
}
