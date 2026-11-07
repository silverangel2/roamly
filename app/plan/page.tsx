import type { Metadata } from "next";
import { TripPlanForm } from "@/components/plan/TripPlanForm";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { createRoamlySessionToken } from "@/lib/roamly/session-token";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { build2GatesEnabled } from "@/lib/roamly/build2Flags";
import { getRoamlySetupState } from "@/lib/roamly/setupState";
import { hasAnyTrip } from "@/lib/roamly/setupGate";

export const metadata: Metadata = {
  title: "Plan a Trip by Budget — AI Itinerary Planner",
  description: "Roamly builds a realistic, budget-aware day-by-day trip itinerary around your pace, interests, and budget. Start with one free itinerary.",
  alternates: { canonical: "https://roamlyhq.com/plan" },
  openGraph: {
    title: "Roamly — Plan a trip by budget | AI itinerary planner",
    description: "Build a realistic, budget-aware day-by-day itinerary with Roamly's AI trip planner. Start with one free itinerary.",
    url: "https://roamlyhq.com/plan",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default async function PlanPage() {
  const current = await getCurrentUser();
  const supabase = current.user ? await createSupabaseServerClient() : null;
  const [, free] =
    supabase && current.user
      ? await Promise.all([
          ensureRoamlyProfileBestEffort(current.user, {}, supabase, "plan_page"),
          hasUsedFreeItinerary(supabase, current.user.id)
        ])
      : [null, null];
  const freeItineraryUsed = Boolean(free?.used);
  const access = getRoamlyAccessForUser(current.user?.email);
  // Second-time disclosure (owner law, 2026-10-24): a signed-in traveler
  // who already has a trip and hasn't finished setup will meet the gate
  // when this new trip opens — say so BEFORE generation, not after.
  const planUser = current.user;
  const secondTimeGateNotice =
    planUser && supabase
      ? await (async () => {
          const state = await getRoamlySetupState(supabase, planUser).catch(() => null);
          if (!state || state.complete) return false;
          return hasAnyTrip(supabase, planUser.id);
        })()
      : false;
  const apiAuthToken = createRoamlySessionToken(current.user, [
    { method: "POST", path: "/api/roamly/price-discovery" },
    { method: "POST", path: "/api/trips/draft" },
    { method: "POST", path: "/api/stripe/create-trip-checkout" },
    { method: "POST", path: "/api/trips/generate" }
  ]);

  return (
    <div className="safe-bottom min-w-0 bg-cbg">
      {/* Plan-flow redesign (2026-11-03): plan creation is a full-screen
          sheet — one focused column taking the whole screen, isolated
          from the rest of the page. */}
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col px-3 py-4 sm:px-6 sm:py-8">
        <header className="bui-enter mb-4">
          <h1 className="text-sm font-semibold text-cgray">Plan a trip</h1>
        </header>
        <TripPlanForm freeItineraryUsed={freeItineraryUsed} testerAccess={access.hasQaAccess} apiAuthToken={apiAuthToken} build2GatesEnabled={build2GatesEnabled()} secondTimeGateNotice={secondTimeGateNotice} />
      </div>

      {/* SEO-FIX-5 (consolidation 2026-11-06, Block I): the plan
          page served crawlers ~252 visible characters — the form
          is a client component, so the served HTML was nav + a
          heading. This server-rendered section sits BELOW the
          full-screen sheet: the form's behaviour and face are
          untouched, and the page now explains itself in the HTML
          every visitor and crawler receives. Copy is held to the
          same honesty discipline as the rest of the site (real
          capabilities, real prices). */}
      <section aria-label="How Roamly planning works" className="mx-auto w-full max-w-3xl px-3 pb-16 pt-2 sm:px-6">
        <h2 className="text-2xl font-black tracking-tight text-chead">How Roamly plans a trip</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-cink">
          Tell Roamly where you are going, when, and who is travelling — one step at a time. Roamly then
          builds a day-by-day itinerary from real places with checked map coordinates, plans each day
          around your budget and pace, and sequences stops using real travel times between them, so a
          day never asks you to be in two places at once.
        </p>
        <h2 className="mt-8 text-2xl font-black tracking-tight text-chead">What you get</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-cink">
          A full itinerary for every day of the trip: where to go in the morning, afternoon, and evening,
          a budget breakdown, hotel-area guidance, food and activity ideas, and map links for every stop.
          During the trip, the optional Live Companion sends a message at the start of each travel day and
          shows what is near when you open Roamly — location is foreground-only, checked only while the
          app is open on screen.
        </p>
        <h2 className="mt-8 text-2xl font-black tracking-tight text-chead">Pricing, plainly</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-cink">
          Your first itinerary is free — one per account. A Full Itinerary for another trip is a one-time
          CAD $4.99, Live Companion is CAD $3.99 per trip, and the Complete Trip Pack (Full Itinerary +
          Companion) is CAD $7.99 per trip. No subscriptions: you see the one-time total before you pay,
          and a plan is never charged twice for the same trip.
        </p>
      </section>
    </div>
  );
}
