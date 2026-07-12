type RoamlyGeneratingLoaderProps = {
  className?: string;
};

const statusMessages = [
  "Checking your route",
  "Balancing your budget",
  "Finding smarter travel days",
  "Organizing your city stops",
  "Preparing your Live Companion"
];

export function RoamlyGeneratingLoader({ className = "" }: RoamlyGeneratingLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative isolate overflow-hidden rounded-[2rem] border border-white/85 bg-white/85 px-4 py-6 text-ink shadow-[0_28px_90px_rgba(14,116,144,0.2)] backdrop-blur-2xl sm:px-7 sm:py-7 ${className}`}
    >
      <div className="pointer-events-none absolute -left-16 top-6 h-48 w-48 rounded-full bg-cyan-200/60 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-8 h-52 w-52 rounded-full bg-lagoon/45 blur-3xl" />
      <div className="pointer-events-none absolute right-12 top-10 h-28 w-28 rounded-full bg-sun/35 blur-2xl" />
      <div className="pointer-events-none absolute inset-x-10 top-14 h-24 rounded-full bg-sky-200/20 blur-3xl" />

      <div className="relative mx-auto grid max-w-2xl place-items-center text-center">
        <div className="roamly-wordmark-stage relative mx-auto h-44 w-full max-w-[34rem] sm:h-56" aria-hidden="true">
          <div className="absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-full bg-white/70 shadow-[0_20px_70px_rgba(14,116,144,0.12)] sm:inset-x-12 sm:h-28" />
          <svg
            viewBox="0 0 520 220"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 z-0 h-full w-full overflow-visible"
          >
            <defs>
              <linearGradient id="roamlyFlightGradient" x1="52" x2="472" y1="174" y2="34" gradientUnits="userSpaceOnUse">
                <stop stopColor="#ffb84d" stopOpacity="0.82" />
                <stop offset="0.42" stopColor="#22d3ee" stopOpacity="0.76" />
                <stop offset="1" stopColor="#1b9aaa" stopOpacity="0.82" />
              </linearGradient>
            </defs>
            <path
              d="M48 146 C112 70 228 43 341 70 C442 94 492 50 436 28 C385 9 338 39 365 83 C392 126 312 166 212 164 C118 162 72 190 122 205 C203 230 405 204 464 140"
              fill="none"
              stroke="url(#roamlyFlightGradient)"
              strokeLinecap="round"
              strokeWidth="2.5"
              strokeDasharray="3 13"
              className="roamly-route-dash opacity-80"
            />
            <path
              d="M72 147 C154 96 219 91 276 104 C327 116 381 102 428 58"
              fill="none"
              stroke="#0e7490"
              strokeLinecap="round"
              strokeWidth="1.5"
              strokeDasharray="2 14"
              opacity="0.18"
            />
            <circle cx="55" cy="147" r="4.5" fill="#ffb84d" opacity="0.95" />
            <circle cx="436" cy="28" r="4" fill="#22d3ee" opacity="0.9" />
            <circle cx="464" cy="140" r="3.5" fill="#54d6c6" opacity="0.86" />
          </svg>

          <div className="absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 px-4">
            <span className="inline-block bg-gradient-to-r from-ink via-cyan-700 to-lagoon bg-clip-text text-5xl font-black leading-none tracking-normal text-transparent drop-shadow-[0_12px_30px_rgba(14,116,144,0.13)] sm:text-7xl">
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
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Roamly is planning</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
            Roamly is building your itinerary
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm font-bold leading-6 text-slate-600">
            Checking route, budget, booking options, and travel style.
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
