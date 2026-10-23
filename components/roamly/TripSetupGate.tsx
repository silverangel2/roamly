"use client";

/*
 * SetupGateScreen — the "Your trip is ready" moment (owner design,
 * 2026-10-23). The trip page renders this INSTEAD of the itinerary
 * while the traveler's setup was never completed; the moment the last
 * step lands, it refreshes the route and the server serves the trip.
 *
 * The gate keys on the traveler's persisted state, never on the
 * trip: completed once, it never renders again — a returning traveler
 * walks straight in.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoamlySetupState } from "@/lib/roamly/setupState";
import { SetupCascade } from "@/components/roamly/SetupCascade";

export function SetupGateScreen({
  initialState,
  tripName
}: {
  initialState: RoamlySetupState;
  tripName: string;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState(initialState);

  const handleStateChange = useCallback(
    (state: RoamlySetupState) => {
      setSetup(state);
      if (state.complete) router.refresh();
    },
    [router]
  );

  if (setup.complete) {
    return (
      <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-3xl items-center px-4 py-10 sm:px-6">
        <p className="text-base font-semibold leading-7 text-slate-600">All set — opening your trip…</p>
      </div>
    );
  }

  return (
    <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-3xl items-start px-4 py-10 sm:px-6">
      <section className="w-full rounded-[1.75rem] border border-cloud bg-white/90 p-6 shadow-soft sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Your trip is ready</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">{tripName}</h1>
        <p className="mt-3 text-base font-semibold leading-7 text-slate-600">
          Three steps, once — then everything works. Done here, they are remembered forever: no setup on
          your next trip, or the one after.
        </p>
        <div className="mt-4">
          <SetupCascade initialState={setup} onStateChange={handleStateChange} />
        </div>
        <p className="mt-4 text-sm font-semibold leading-6 text-slate-400">
          Your itinerary is saved and waiting — it opens the moment the steps are done.
        </p>
      </section>
    </div>
  );
}
