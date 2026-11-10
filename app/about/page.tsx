import type { Metadata } from "next";
import { BuiButtonLink } from "@/components/boardui/Button";

export const metadata: Metadata = {
  title: "About Roamly",
  description: "Roamly builds a day-by-day itinerary around your pace and budget. One free itinerary per account, then one-time unlocks."
};

export default function AboutPage() {
  return (
    <div className="safe-bottom mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">About</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-chead">A trip plan you can actually follow.</h1>
      <p className="mt-4 text-base font-semibold leading-7 text-cink">
        Roamly shapes a day-by-day itinerary around where you are going, when you travel, and what you want to spend.
        One full itinerary is included per account. Later trips and Live Companion are one-time prices, not a subscription.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <BuiButtonLink href="/plan">Plan a trip</BuiButtonLink>
        <BuiButtonLink href="/pricing" variant="secondary">See pricing</BuiButtonLink>
        <BuiButtonLink href="/contact" variant="ghost">Contact</BuiButtonLink>
      </div>
    </div>
  );
}
