import type { Metadata } from "next";
import Link from "next/link";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";

export const metadata: Metadata = {
  title: "Live Companion — help on your travel days",
  description:
    "Roamly Live Companion: a message at the start of each travel day, plus nearby help and timing flags while Roamly is open on your trip. Foreground-only location — no background tracking, no turn-by-turn directions.",
  // SEO (consolidation 2026-11-06, Block I / SEO-FIX-4 + FIX-6):
  // self-referencing canonical + the page's own og:url (it
  // previously inherited the root) and og:type.
  alternates: { canonical: "https://roamlyhq.com/companion" },
  openGraph: {
    title: "Live Companion — help on your travel days",
    description:
      "A message at the start of each travel day, plus nearby help and timing flags while Roamly is open on your trip. Foreground-only location.",
    url: "https://roamlyhq.com/companion",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

/*
 * The Companion sales page (consolidation 2026-11-06, sweep
 * NEW-7). This page replaces the old disposition stub: Companion
 * is a paid add-on and it gets a real product page — but an
 * HONEST one, written to the Terms discipline (GAP-REPORT §4):
 * every claim below is something Live Companion does today.
 * Travel-day messages are true since the travel-day fix; location
 * is foreground-only and says so; there is no turn-by-turn claim
 * anywhere. One filled primary CTA, per the pricing rules.
 */
const DOES_TODAY = [
  {
    title: "A message at the start of every travel day",
    body: "Each morning of your trip, Live Companion sends the day ahead: the plan, the first stop, and the honest limits of the day's weather — before you leave the hotel, not after something goes wrong."
  },
  {
    title: "Nearby help while Roamly is open",
    body: "Open Roamly on a travel day and it shows what is near you right now, flags when you are running behind the plan, and offers a one-tap change — reordering stops or swapping one — that only happens when you approve it."
  },
  {
    title: "Only on your travel days",
    body: "Live Companion runs during the days of your trip and is off the rest of the time. You can switch it off whenever you like, and switching it off is remembered."
  }
];

const DOES_NOT = [
  "No background tracking: location is checked only while Roamly is open on screen (foreground-only).",
  "No turn-by-turn directions: stops link out to your maps app for navigation.",
  "No locked-phone alerts: messages arrive on your travel days; nearby help appears when you open Roamly."
];

const FAQS = [
  {
    q: "How much is Live Companion?",
    a: "CAD $3.99 per trip, or as part of the Companion Pack (Full Trip + Companion) at CAD $7.99 per trip. The free tier plans the trip; Companion is the on-trip help."
  },
  {
    q: "Does it follow me everywhere?",
    a: "No. It only works during your trip's travel days, and location is foreground-only — Roamly sees where you are only while the app is open on screen."
  },
  {
    q: "Can I turn it off?",
    a: "Any time, from the trip or your account. Off is remembered — you will not be asked again and again."
  }
];

export default function CompanionPage() {
  return (
    <div className="bui-enter safe-bottom mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Live Companion</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-chead">
        A companion for your travel days — not a tracker.
      </h1>
      <p className="mt-4 text-base font-semibold leading-7 text-cink">
        Live Companion is the on-trip half of Roamly. Your plan is built before you go; Companion is what
        helps while you are actually there — a steady message at the start of each travel day, and nearby
        help when you open Roamly.
      </p>

      <div className="mt-8 grid gap-4">
        {DOES_TODAY.map((item) => (
          <BuiCard key={item.title} className="p-5">
            <h2 className="text-[17px] font-bold leading-snug text-chead">{item.title}</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-cink">{item.body}</p>
          </BuiCard>
        ))}
      </div>

      <BuiCard className="mt-4 p-5">
        <h2 className="text-[17px] font-bold leading-snug text-chead">What it does not do</h2>
        <ul className="mt-2 grid gap-1.5">
          {DOES_NOT.map((line) => (
            <li key={line} className="text-[15px] leading-relaxed text-cink">
              {line}
            </li>
          ))}
        </ul>
      </BuiCard>

      <div className="mt-8">
        <BuiButtonLink href="/plan" className="w-full sm:w-auto">
          Plan a trip with Companion
        </BuiButtonLink>
        <p className="mt-3 text-sm leading-6 text-cgray">
          Companion is added per trip at checkout — see{" "}
          <Link href="/pricing" className="font-semibold text-cblue">
            pricing
          </Link>{" "}
          for the exact per-trip prices. Already have a trip? Open it from{" "}
          <Link href="/dashboard" className="font-semibold text-cblue">
            Trips
          </Link>{" "}
          and turn Live on inside it.
        </p>
      </div>

      <div className="mt-10 grid gap-4">
        {FAQS.map((item) => (
          <div key={item.q}>
            <h2 className="text-[16px] font-bold leading-snug text-chead">{item.q}</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-cink">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
