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
  eyebrow
}: {
  initialState: RoamlySetupState;
  /** Trip name · short dates — the mock's eyebrow ("Montreal · Oct 30 – Nov 2"). */
  eyebrow: string;
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
      <div className="calm-bleed calm-crossfade mx-auto flex min-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] w-full max-w-3xl items-center px-4 py-10 sm:px-6">
        <p className="text-base font-normal leading-7 text-cgray">All set — opening your trip…</p>
      </div>
    );
  }

  return (
    <div className="calm-bleed calm-crossfade mx-auto flex min-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] w-full max-w-3xl items-start px-4 pb-10 pt-5 sm:px-6">
      <section className="w-full">
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{eyebrow}</p>
        <h1 className="mt-1.5 text-[34px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">Your trip is ready</h1>
        <p className="mt-2.5 max-w-[330px] text-base font-normal leading-[1.45] text-cink">
          Three steps, once — then everything works. Done here, they are remembered forever.
        </p>
        <p className="mb-2 ml-4 mt-5 text-[13px] font-semibold uppercase tracking-[0.05em] text-cgray">Finish setup</p>
        <SetupCascade initialState={setup} onStateChange={handleStateChange} variant="compact" />
        <p className="mt-6 text-center text-[15px] font-normal leading-[1.45] text-cgray">
          Your itinerary is saved and waiting — it opens the moment the steps are done.
        </p>
      </section>
    </div>
  );
}
