"use client";

import Script from "next/script";

const AIRALO_IMPACT_SRC = "https://utt.impactcdn.com/P-A7477674-2a8b-4b81-b4c9-7dd30f6135141.js";

declare global {
  interface Window {
    impactStat?: ((eventName: "trackImpression" | string, ...args: unknown[]) => void) & {
      a?: unknown[];
    };
  }
}

export function AiraloImpactScript() {
  if (process.env.NEXT_PUBLIC_AIRALO_IMPACT_ENABLED !== "true") return null;

  return (
    <Script
      id="airalo-impact"
      strategy="afterInteractive"
      src={AIRALO_IMPACT_SRC}
      onLoad={() => {
        window.impactStat?.("trackImpression");
      }}
    />
  );
}
