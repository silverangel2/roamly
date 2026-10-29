"use client";

/*
 * SetupGateScreen — the "Your trip is ready!" moment, OWNER-APPROVED
 * DESIGN (2026-10-26, composite correct-4-pages.jpg, bottom-left
 * panel, built exactly as designed): eyebrow · "Your trip is ready!
 * 🎉" · "Everything is prepared…" · "Itinerary generated and saved"
 * · "Optional setup (recommended)" with the three cards · OR ·
 * "Skip for now" card. Layout, copy, and actions follow that panel.
 *
 * HARD LIMITS (owner decision, same day): the "Optional" framing
 * covers FEATURE ENABLEMENT ONLY. Gate law, billing, the
 * one-free-itinerary-per-account policy, and entitlement checks are
 * INTACT and untouched here: this screen still renders only when
 * lib/roamly/setupGate.ts says the gate applies; steps still complete
 * only on server-verified evidence (SetupCascade); and Skip still
 * reveals the itinerary WITH LIMITED FEATURES (the trip page's
 * banner names them after reveal). This screen builds no bypass.
 *
 * Two deliberate deviations from a pixel copy, both forced by the
 * hard limits (flagged, not silent):
 *   - The "Itinerary generated and saved" row is a STATUS row, not a
 *     link: linking it to the itinerary would bypass the gate. Its
 *     chevron is decorative, matching the mock's card language.
 *   - The limited-features list is not repeated on this screen (the
 *     mock has none); the reveal banner after Skip names them.
 *   - Step icons are simple inline glyphs, not brand artwork.
 *   - Phone chrome in the mock (status bar, back arrow) is device
 *     chrome, not screen content, and is not reproduced.
 *
 * Picture 3 literal fixes (2026-10-26, enlarged bottom-left crop
 * read firsthand): the itinerary card is pale green with a solid
 * green check circle and green chevron; the Gmail button is SOLID
 * blue (the other two stay blue-outline, as in the picture); the
 * Skip card's text is centered with the chevron at the right edge;
 * every optional-card button sits under the TEXT column (indented
 * past the icon), as in the picture. The Skip card stays white on
 * this screen's grey page ground (the picture's grey card on its
 * white ground is the same card-vs-ground contrast, inverted).
 * and REMEMBERED per trip (see lib/roamly/setupSkip.ts — a cookie
 * the server gate reads on return, so a returning traveler is not
 * gated again for this trip). Remembered skip still never completes
 * a step.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoamlySetupState } from "@/lib/roamly/setupState";
import { setupSkipCookieAssignment } from "@/lib/roamly/setupSkip";
import { SetupCascade } from "@/components/roamly/SetupCascade";

export function SetupGateScreen({
  initialState,
  eyebrow,
  skipHref,
  tripId
}: {
  initialState: RoamlySetupState;
  /** Trip identity in the mock's form ("Montreal, Canada · Oct 26 – Oct 30, 2026"), rendered uppercased. */
  eyebrow: string;
  /** Skip path — reveals the itinerary with limited features. */
  skipHref: string;
  /** Trip the skip is remembered for (cookie key); omitted only where no trip exists. */
  tripId?: string;
  /** Kept for callers: the day count is not rendered in the approved design. */
  dayCount?: number;
  /** Kept for callers: the limited-features list is not rendered on
   *  this screen (the mock has none); the reveal banner names them. */
  limitedFeatures?: string[];
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

  const handleSkip = useCallback(() => {
    // Remember this trip's skip BEFORE navigating: the server gate
    // reads the cookie on the next visit, so the return trip reveals
    // without re-skipping. The navigation itself (skipHref, with
    // ?skipSetupGate=1) reveals immediately on this visit.
    const assignment = setupSkipCookieAssignment(tripId);
    if (assignment) {
      try {
        document.cookie = assignment;
      } catch {
        // Cookie write failure is not fatal: the URL param still
        // reveals this visit; only the remembering is lost.
      }
    }
  }, [tripId]);

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
        <h1 className="mt-1.5 text-[30px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">Your trip is ready! 🎉</h1>
        <p className="mt-2.5 max-w-[330px] text-base font-normal leading-[1.45] text-cink">
          Everything is prepared. Complete a few optional steps to unlock more features.
        </p>
        <div className="mt-4 flex items-center rounded-2xl bg-cgreen/10 p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cgreen text-base font-bold text-white" aria-hidden="true">✓</span>
          <p className="min-w-0 flex-1 px-3 text-[17px] font-semibold leading-tight text-chead">Itinerary generated and saved</p>
          <span aria-hidden="true" className="shrink-0 text-xl leading-none text-cgreen">›</span>
        </div>
        <h2 className="mb-3 mt-6 text-[19px] font-bold tracking-[-0.018em] text-chead">Optional setup (recommended)</h2>
        <SetupCascade initialState={setup} onStateChange={handleStateChange} variant="optional" />
        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-chair" />
          <span className="text-[15px] font-normal text-cgray">OR</span>
          <span className="h-px flex-1 bg-chair" />
        </div>
        <a
          href={skipHref}
          onClick={handleSkip}
          className="flex items-center rounded-2xl bg-white p-4 shadow-calm"
        >
          <p className="min-w-0 flex-1 text-center text-[17px] font-semibold leading-tight text-chead">Skip for now</p>
          <span aria-hidden="true" className="shrink-0 text-xl leading-none text-cchev">›</span>
        </a>
        <p className="mt-2 text-center text-[15px] font-normal leading-[1.45] text-cgray">
          You can still view your full itinerary with limited features.
        </p>
      </section>
    </div>
  );
}
