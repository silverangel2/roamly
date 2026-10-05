import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Live Companion — inside your trip",
  description: "Roamly Live Companion opens from a trip. There is no separate Companion product page."
};

export default function CompanionDispositionPage() {
  return (
    <div className="safe-bottom mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Live Companion</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-ink">Companion lives inside a trip.</h1>
      <p className="mt-4 text-base font-semibold leading-7 text-slate-600">
        Open Trips, choose a trip with Companion unlocked, then use Live. Guests sign in before a trip Companion page will open.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/dashboard">Go to Trips</Button>
        <Button href="/login?next=/dashboard" tone="secondary">Log in</Button>
      </div>
    </div>
  );
}
