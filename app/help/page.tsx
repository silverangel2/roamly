import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Help — Roamly",
  description: "Get help with a Roamly trip, account, or booking question."
};

export default function HelpPage() {
  return (
    <div className="safe-bottom mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Help</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-ink">Need a hand with a trip?</h1>
      <p className="mt-4 text-base font-semibold leading-7 text-slate-600">
        Send the destination, the account email, and what happened. Booking changes with an airline or hotel still belong with that provider.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/contact">Contact support</Button>
        <Button href="/plan" tone="secondary">Plan a trip</Button>
        <Button href="/pricing" tone="ghost">Pricing</Button>
      </div>
    </div>
  );
}
