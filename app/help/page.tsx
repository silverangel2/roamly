import type { Metadata } from "next";
import { BuiButtonLink } from "@/components/boardui/Button";

export const metadata: Metadata = {
  title: "Help — Roamly",
  description: "Get help with a Roamly trip, account, or booking question."
};

export default function HelpPage() {
  return (
    <div className="safe-bottom mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Help</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-chead">Need a hand with a trip?</h1>
      <p className="mt-4 text-base font-semibold leading-7 text-cink">
        Send the destination, the account email, and what happened. Booking changes with an airline or hotel still belong with that provider.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <BuiButtonLink href="/contact">Contact support</BuiButtonLink>
        <BuiButtonLink href="/plan" variant="secondary">Plan a trip</BuiButtonLink>
        <BuiButtonLink href="/pricing" variant="ghost">Pricing</BuiButtonLink>
      </div>
    </div>
  );
}
