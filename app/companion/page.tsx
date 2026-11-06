import type { Metadata } from "next";
import { BuiButtonLink } from "@/components/boardui/Button";

export const metadata: Metadata = {
  title: "Live Companion — inside your trip",
  description: "Roamly Live Companion opens from a trip. There is no separate Companion product page."
};

export default function CompanionDispositionPage() {
  return (
    <div className="bui-enter safe-bottom mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Live Companion</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-chead">Companion lives inside a trip.</h1>
      <p className="mt-4 text-base font-semibold leading-7 text-cink">
        Open Trips, choose a trip with Companion unlocked, then use Live. Guests sign in before a trip Companion page will open.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <BuiButtonLink href="/dashboard">Go to Trips</BuiButtonLink>
        <BuiButtonLink href="/login?next=/dashboard" variant="secondary">Log in</BuiButtonLink>
      </div>
    </div>
  );
}
