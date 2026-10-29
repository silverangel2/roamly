"use client";

/*
 * LimitedFeaturesNotice — compact expandable setup notice (final
 * local round, 2026-10-27). It replaces the long inline paragraph
 * ("Showing with limited features: Booking Recon — needs Gmail ·
 * Live Companion alerts — needs the app · Companion goes live —
 * needs location. Finish setup anytime in Settings to turn
 * everything on.") with one short collapsed line that EXPANDS on
 * tap to the same details, word for word.
 *
 * Meaning is unchanged by the compaction — this is presentation
 * only, and the setup-gate function is untouched:
 * - the collapsed line is the limited-features state + a "Finish
 *   setup" affordance (the <summary> itself expands the notice);
 * - the expanded state carries the exact same feature strings the
 *   caller computed (setupGateLimitedFeatures) and the exact same
 *   closing sentence, with a real link to Settings (/account, the
 *   gear destination everywhere else in the app) so the notice
 *   still routes to setup;
 * - no feature claim is added, dropped, or reworded: the list is
 *   rendered from the caller's array, never retyped here.
 * The native <details> element is the expand mechanism: no JS
 * state, no invented tap target, and it stays expanded or collapsed
 * exactly as the traveler leaves it.
 */

export function LimitedFeaturesNotice({ features }: { features: string[] }) {
  if (!features.length) return null;
  return (
    <details
      data-testid="limited-features-notice"
      className="mb-4 rounded-xl bg-white px-4 py-3 shadow-calm"
    >
      <summary className="cursor-pointer list-none text-[15px] font-medium leading-[1.45] text-cink">
        Showing with limited features · Finish setup <span aria-hidden="true">▸</span>
      </summary>
      <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
        Showing with limited features{`: ${features.join(" · ")}`}.{" "}
        <a href="/account" className="font-medium text-chead underline decoration-chair underline-offset-2">
          Finish setup
        </a>{" "}
        anytime in Settings to turn everything on.
      </p>
    </details>
  );
}
