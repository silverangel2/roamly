import type { Metadata } from "next";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Pricing tiers (owner pricing rules, 2026-11-04 — applied in the
 * BoardUI branch): ONE tier is the pick and the only highlighted
 * card; the "Most popular" badge exists on that tier only; every
 * card lists what CHANGES versus the tier below it ("Everything
 * in …, plus…" in ~three lines), never the same wall of checkmarks
 * repeated; and the page carries ONE filled primary button — the
 * pick's — with outlined buttons on the rest. Prices are the real
 * one-time CAD prices; there is no monthly/annual variant (the
 * product is one-time, "No Subscriptions"), so the toggle rule is
 * honestly not applicable — the Pack card instead states its real
 * money saving versus buying its parts separately.
 */
const plans = [
  {
    title: "Free itinerary",
    price: "$0",
    unit: "one per account",
    body: "Build one complete custom trip itinerary at no cost.",
    changes: ["One complete custom itinerary", "Day-by-day plan with budget guidance", "No card needed — yours to keep"],
    cta: "Plan a trip",
    href: "/plan",
    pick: false
  },
  {
    title: "Full Itinerary",
    price: "$4.99 CAD",
    unit: "per trip · one-time",
    body: "Unlock one custom, day-by-day itinerary, planned around your budget and your pace.",
    changes: [
      "Everything in Free itinerary, plus…",
      "Budget, hotel-area, transport, food and activity guidance in depth",
      "A locked final itinerary for the trip"
    ],
    cta: "Unlock an itinerary",
    href: "/plan",
    pick: false
  },
  {
    title: "Live Trip Companion",
    price: "$3.99 CAD",
    unit: "per trip · one-time",
    body: "Add pre-trip reminders, a booking timeline, nearby activity ideas, and up-next help to an unlocked itinerary.",
    changes: [
      "Adds to an unlocked itinerary…",
      "Pre-trip reminders and a booking timeline",
      "Nearby activity ideas and up-next help while you travel"
    ],
    cta: "Add the Companion",
    href: "/plan",
    pick: false
  },
  {
    title: "Complete Trip Pack",
    price: "$7.99 CAD",
    unit: "per trip · one-time",
    body: "Get the full itinerary and Live Trip Companion together for one trip.",
    changes: [
      "Everything in Full Itinerary, plus…",
      "Live Trip Companion included — reminders, timeline and up-next help",
      "Bought separately they cost $8.98 — the Pack saves you $0.99"
    ],
    cta: "Get the Complete Trip Pack",
    href: "/plan",
    pick: true
  }
];

const included = [
  "Full day-by-day itinerary",
  "Budget breakdown",
  "Hotel area suggestions",
  "Transport guide",
  "Food and activity ideas",
  "Map search links",
  "Locked final itinerary",
  "Trip reminders and timeline",
  "Packing and emergency tips",
  "Booking-aware planning"
];

export const metadata: Metadata = {
  title: "Pricing — One-Time Trip Plans, No Subscriptions",
  description: "Roamly pricing: one free itinerary, full day-by-day trip itineraries from $4.99 CAD, and Live Trip Companion packs. One-time prices, no subscriptions.",
  alternates: { canonical: "https://roamlyhq.com/pricing" },
  openGraph: {
    title: "Roamly Pricing — one-time trip plans",
    description: "One free itinerary, full trip itineraries from $4.99 CAD, Live Trip Companion packs. One-time prices, no subscriptions.",
    url: "https://roamlyhq.com/pricing",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default async function PricingPage() {
  const current = await getCurrentUser();
  const signedIn = Boolean(current.user);
  const supabase = signedIn ? await createSupabaseServerClient() : null;
  const free = supabase && current.user ? await hasUsedFreeItinerary(supabase, current.user.id) : null;
  const freeUsed = Boolean(free?.used);

  return (
    <div className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#E6EFFA_52%,#FFF0E6)] p-6 text-ink shadow-bui-hero sm:p-10">
        <BuiBadge tone="warm">Simple trip pricing</BuiBadge>
        <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
          A better trip plan, with clear one-time prices.
        </h1>
        <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-700">
          One free itinerary per account. Unlock another trip or add Live Companion only when you choose to, and you see the one-time total before paying.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          {signedIn ? (
            <>
              <BuiButtonLink href="/plan">{freeUsed ? "Unlock itinerary" : "Plan a trip"}</BuiButtonLink>
              <BuiButtonLink href="/dashboard" variant="secondary">Go to Trips</BuiButtonLink>
            </>
          ) : (
            <>
              <BuiButtonLink href="/plan">Start planning</BuiButtonLink>
              <BuiButtonLink href="/signup?next=/plan" variant="secondary">Create your free account</BuiButtonLink>
            </>
          )}
        </div>
      </section>

      {/* Pricing rules (2026-11-04): the Complete Trip Pack is the
          ONE pick — it lifts (offset + lift shadow + accent ring),
          carries the page's only "Most popular" badge; every
          card's button is outlined, and each card lists only what
          changes versus the tier below. The page's ONE filled
          primary is the hero's first CTA (consolidation
          2026-11-06, sweep NEW-6: the hero previously showed no
          filled action at all). */}
      <section className="mt-8 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <BuiCard
            key={plan.title}
            interactive
            className={`flex flex-col p-5 ${plan.pick ? "border-cblue/60 bg-csoft shadow-bui-lift ring-1 ring-cblue/40 lg:-translate-y-2" : ""}`}
          >
            {plan.pick ? (
              <span className="mb-3 self-start">
                <BuiBadge tone="primary">Most popular</BuiBadge>
              </span>
            ) : null}
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{plan.title}</p>
            <p className="mt-5 bui-display-number text-3xl font-black tracking-tight text-ink">{plan.price}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">{plan.unit}</p>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">{plan.body}</p>
            <ul className="mt-4 flex flex-col gap-2">
              {plan.changes.map((line) => (
                <li key={line} className="flex gap-2 text-sm font-semibold leading-5 text-slate-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cblue">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <span className="mt-auto block pt-5">
              <BuiButtonLink href={plan.href} variant="secondary" className="w-full">
                {plan.cta}
              </BuiButtonLink>
            </span>
          </BuiCard>
        ))}
      </section>

      <section className="mt-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <BuiBadge tone="primary">Included with a full itinerary</BuiBadge>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-5xl">
              The details that make a trip easier to follow.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            You’ll see the selected trip and one-time total again before paying.
          </p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {included.map((item) => (
            <BuiCard key={item} className="p-4 text-sm font-black text-ink">{item}</BuiCard>
          ))}
        </div>
      </section>
    </div>
  );
}
