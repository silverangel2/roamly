"use client";

import { useState } from "react";

type DemoAction =
  | "send_test_email"
  | "simulate_delay"
  | "simulate_cancellation"
  | "approval_required"
  | "daily_briefing";

type ActionDefinition = {
  action: DemoAction;
  title: string;
  description: string;
};

const ACTIONS: ActionDefinition[] = [
  {
    action: "send_test_email",
    title: "Send test Companion email",
    description:
      "Sends a real [TEST] transactional email through the Companion delivery pipeline."
  },
  {
    action: "simulate_delay",
    title: "Simulate 2-hour delay",
    description:
      "Creates and sends a real Companion delay notification for the selected trip."
  },
  {
    action: "simulate_cancellation",
    title: "Simulate cancellation",
    description:
      "Creates a critical cancellation alert through the real delivery system."
  },
  {
    action: "approval_required",
    title: "Require repair approval",
    description:
      "Sends an approval-required alert for a Companion repair."
  },
  {
    action: "daily_briefing",
    title: "Send daily briefing",
    description:
      "Sends a controlled daily trip briefing through the transactional email system."
  }
];

export default function CompanionDemoConsole() {
  const [tripId, setTripId] = useState("");
  const [running, setRunning] = useState<DemoAction | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function runAction(action: DemoAction) {
    setRunning(action);
    setResult(null);

    try {
      const response = await fetch("/api/admin/roamly/companion-demo", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action,
          tripId: tripId.trim() || null
        })
      });

      const payload = (await response.json()) as Record<string, unknown>;

      setResult({
        httpStatus: response.status,
        ...payload
      });
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Companion Demo request failed."
      });
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[2rem] border border-cloud bg-white/90 p-6 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
          Companion Demo Mode
        </p>

        <h1 className="mt-2 text-3xl font-black text-ink">
          Test the real Companion pipeline
        </h1>

        <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
          These actions use the production Companion notification queue,
          delivery records, email provider, retry logic, and notification
          history. Emails are marked as controlled tests.
        </p>

        <label className="mt-6 block">
          <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            Trip ID
          </span>

          <input
            value={tripId}
            onChange={(event) => setTripId(event.target.value)}
            placeholder="Optional for the basic email test"
            className="mt-2 w-full rounded-2xl border border-cloud bg-mist px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
          />
        </label>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {ACTIONS.map((item) => (
          <article
            key={item.action}
            className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft"
          >
            <h2 className="text-lg font-black text-ink">{item.title}</h2>

            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              {item.description}
            </p>

            <button
              type="button"
              disabled={running !== null}
              onClick={() => runAction(item.action)}
              className="mt-5 rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === item.action ? "Running…" : item.title}
            </button>
          </article>
        ))}
      </section>

      {result ? (
        <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
            Result
          </p>

          <pre className="mt-4 max-h-[32rem] overflow-auto rounded-2xl bg-ink p-4 text-xs font-bold leading-5 text-white/80">
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
