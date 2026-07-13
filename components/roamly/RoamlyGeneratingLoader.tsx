type RoamlyGeneratingLoaderProps = {
  className?: string;
};

const statusMessages = [
  "Checking your route",
  "Comparing travel options",
  "Matching your budget",
  "Organizing your itinerary",
  "Preparing your trip companion"
];

export function RoamlyGeneratingLoader({ className = "" }: RoamlyGeneratingLoaderProps) {
  const flightPath =
    "M 54 148 C 128 76 226 50 319 78 C 391 100 451 76 475 38 C 434 94 374 133 292 137 C 202 141 129 163 76 198";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative isolate overflow-hidden rounded-[2rem] border border-white/80 bg-white/82 px-4 py-6 text-ink shadow-[0_30px_90px_rgba(15,32,51,0.16)] backdrop-blur-2xl sm:px-7 sm:py-8 ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(186,230,253,0.45),transparent_30%),radial-gradient(circle_at_82%_20%,rgba(255,214,150,0.28),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.72),rgba(240,249,255,0.44)_52%,rgba(255,247,237,0.48))]" />
      <div className="pointer-events-none absolute inset-x-10 top-8 h-28 rounded-full bg-cyan-200/18 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-lagoon/18 blur-3xl" />

      <div className="relative mx-auto grid max-w-2xl place-items-center text-center">
        <div className="roamly-wordmark-stage relative mx-auto h-44 w-full max-w-[34rem] sm:h-60" aria-hidden="true">
          <div className="absolute inset-x-4 top-1/2 h-28 -translate-y-1/2 rounded-[1.75rem] border border-white/85 bg-white/72 shadow-[0_22px_70px_rgba(15,32,51,0.1)] sm:inset-x-10 sm:h-32" />
          <svg
            viewBox="0 0 520 220"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 z-0 h-full w-full overflow-visible"
          >
            <defs>
              <linearGradient id="roamlyFlightGradient" x1="52" x2="472" y1="174" y2="34" gradientUnits="userSpaceOnUse">
                <stop stopColor="#f2a83b" stopOpacity="0.72" />
                <stop offset="0.45" stopColor="#22d3ee" stopOpacity="0.7" />
                <stop offset="1" stopColor="#0f8f9c" stopOpacity="0.78" />
              </linearGradient>
              <filter id="roamlyPlaneShadow" x="-35%" y="-35%" width="170%" height="170%">
                <feDropShadow dx="0" dy="12" stdDeviation="8" floodColor="#0f8f9c" floodOpacity="0.18" />
              </filter>
            </defs>
            <path
              d={flightPath}
              fill="none"
              stroke="url(#roamlyFlightGradient)"
              strokeLinecap="round"
              strokeWidth="2"
              strokeDasharray="1 12"
              className="roamly-route-dash opacity-70"
            />
            <path
              d="M92 154 C166 105 238 98 300 111 C359 123 416 100 455 59"
              fill="none"
              stroke="#0e7490"
              strokeLinecap="round"
              strokeWidth="1"
              strokeDasharray="2 12"
              opacity="0.16"
            />
            <circle cx="54" cy="148" r="4.5" fill="#f2a83b" opacity="0.95" />
            <circle cx="475" cy="38" r="4" fill="#22d3ee" opacity="0.9" />
            <circle cx="76" cy="198" r="3.5" fill="#54d6c6" opacity="0.86" />
            <g className="roamly-plane-static hidden" transform="translate(168 96) rotate(-22)">
              <circle r="18" fill="white" opacity="0.92" />
              <path
                d="M13.8 1.2 -2.2 5.9 -4.4 13.8 -7.1 13.8 -6.1 5.1 -14.2 1.9 -14.2 -1.9 -6.1 -5.1 -7.1 -13.8 -4.4 -13.8 -2.2 -5.9 13.8 -1.2 C16.8 -0.3 16.8 0.3 13.8 1.2Z"
                fill="#0f6f82"
              />
            </g>
            <g className="roamly-plane-animated" filter="url(#roamlyPlaneShadow)">
              <circle r="19" fill="white" opacity="0.95" />
              <path
                d="M13.8 1.2 -2.2 5.9 -4.4 13.8 -7.1 13.8 -6.1 5.1 -14.2 1.9 -14.2 -1.9 -6.1 -5.1 -7.1 -13.8 -4.4 -13.8 -2.2 -5.9 13.8 -1.2 C16.8 -0.3 16.8 0.3 13.8 1.2Z"
                fill="#0f6f82"
              />
              <animateMotion dur="10.5s" repeatCount="indefinite" rotate="auto" path={flightPath} calcMode="paced" />
            </g>
          </svg>

          <div className="absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 px-4">
            <span className="inline-block bg-gradient-to-r from-[#102033] via-[#0f6f82] to-[#1b9aaa] bg-clip-text text-[2.35rem] font-black leading-none tracking-normal text-transparent drop-shadow-[0_14px_32px_rgba(15,32,51,0.12)] sm:text-[3.75rem]">
              Roamly
            </span>
          </div>

          <span className="roamly-destination-dot absolute left-[9%] top-[65%] z-10 h-3 w-3 rounded-full bg-sun shadow-[0_0_0_7px_rgba(255,184,77,0.16)]" />
          <span
            className="roamly-destination-dot absolute right-[14%] top-[20%] z-10 h-2.5 w-2.5 rounded-full bg-cyan-500 shadow-[0_0_0_7px_rgba(6,182,212,0.16)]"
            style={{ animationDelay: "0.45s" }}
          />
          <span
            className="roamly-destination-dot absolute bottom-[22%] right-[10%] z-10 h-2.5 w-2.5 rounded-full bg-lagoon shadow-[0_0_0_7px_rgba(84,214,198,0.18)]"
            style={{ animationDelay: "0.9s" }}
          />

          <div className="roamly-plane-flight absolute z-20 grid h-12 w-12 place-items-center rounded-full border border-cyan-100/90 bg-white text-cyan-700 shadow-[0_16px_42px_rgba(14,116,144,0.24)] ring-8 ring-white/25 sm:h-14 sm:w-14">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 sm:h-7 sm:w-7">
              <path
                fill="currentColor"
                d="M21.8 15.9 14.2 13v4.6l2.1 1.5v1.3l-4.1-1.3-4.1 1.3v-1.3l2.1-1.5V13l-7.6 2.9v-1.8l7.6-4.9V5.4c0-1.1.9-2 2-2s2 .9 2 2v3.8l7.6 4.9v1.8Z"
              />
            </svg>
          </div>
        </div>

        <div className="mt-1">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">Roamly travel concierge</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
            Building your Roamly itinerary
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm font-bold leading-6 text-slate-600">
            Checking routes, budget, booking options, and travel style.
          </p>
        </div>

        <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
          {statusMessages.map((message, index) => (
            <div
              key={message}
              className="roamly-status-chip flex items-center gap-2 rounded-2xl border border-cyan-100/80 bg-white/72 px-3 py-2 text-left text-xs font-black text-slate-700 shadow-[0_10px_28px_rgba(14,116,144,0.08)]"
              style={{ animationDelay: `${index * 0.18}s` }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-cyan-500 to-lagoon" />
              <span>{message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
