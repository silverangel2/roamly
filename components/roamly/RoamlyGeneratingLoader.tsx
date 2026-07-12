import Image from "next/image";

type RoamlyGeneratingLoaderProps = {
  className?: string;
};

const statusMessages = [
  "Checking your route",
  "Balancing your budget",
  "Reviewing booking options",
  "Matching your travel style",
  "Preparing your Live Companion"
];

export function RoamlyGeneratingLoader({ className = "" }: RoamlyGeneratingLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/80 p-5 text-ink shadow-[0_24px_80px_rgba(14,116,144,0.18)] backdrop-blur-2xl sm:p-6 ${className}`}
    >
      <div className="pointer-events-none absolute -left-20 top-6 h-44 w-44 rounded-full bg-cyan-200/55 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-8 h-40 w-40 rounded-full bg-lagoon/45 blur-3xl" />
      <div className="pointer-events-none absolute right-10 top-8 h-24 w-24 rounded-full bg-sun/30 blur-2xl" />

      <div className="relative mx-auto grid max-w-xl place-items-center text-center">
        <div className="relative h-52 w-52 sm:h-60 sm:w-60">
          <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_90deg,rgba(27,154,170,0.08),rgba(84,214,198,0.42),rgba(255,184,77,0.42),rgba(27,154,170,0.08))]" />
          <div className="absolute inset-3 rounded-full border border-cyan-100 bg-white/40 shadow-inner" />
          <div className="roamly-route-dash absolute inset-7 rounded-full border-2 border-dashed border-cyan-300/70" />
          <div className="absolute inset-10 rounded-full border border-white/80 bg-[radial-gradient(circle_at_50%_30%,rgba(236,254,255,0.96),rgba(255,255,255,0.72)_60%,rgba(255,247,237,0.7))]" />

          <span className="roamly-destination-dot absolute left-[12%] top-[39%] h-3 w-3 rounded-full bg-sun shadow-[0_0_0_6px_rgba(255,184,77,0.16)]" />
          <span
            className="roamly-destination-dot absolute right-[14%] top-[31%] h-2.5 w-2.5 rounded-full bg-cyan-500 shadow-[0_0_0_6px_rgba(6,182,212,0.16)]"
            style={{ animationDelay: "0.45s" }}
          />
          <span
            className="roamly-destination-dot absolute bottom-[15%] left-[45%] h-2.5 w-2.5 rounded-full bg-lagoon shadow-[0_0_0_6px_rgba(84,214,198,0.18)]"
            style={{ animationDelay: "0.9s" }}
          />

          <div className="roamly-plane-orbit absolute inset-4">
            <div className="absolute left-1/2 top-0 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-cyan-100 bg-white text-cyan-700 shadow-[0_10px_30px_rgba(14,116,144,0.22)]">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                <path
                  fill="currentColor"
                  d="M21.8 15.9 14.2 13v4.6l2.1 1.5v1.3l-4.1-1.3-4.1 1.3v-1.3l2.1-1.5V13l-7.6 2.9v-1.8l7.6-4.9V5.4c0-1.1.9-2 2-2s2 .9 2 2v3.8l7.6 4.9v1.8Z"
                />
              </svg>
            </div>
          </div>

          <div className="absolute inset-[4.35rem] grid place-items-center rounded-[1.35rem] border border-white/85 bg-white/88 px-3 shadow-[0_16px_45px_rgba(15,23,42,0.12)] backdrop-blur sm:inset-[5rem]">
            <Image
              src="/roamly-wordmark@2x.png"
              alt="Roamly"
              width={180}
              height={74}
              className="h-auto w-28 object-contain sm:w-32"
              priority
            />
          </div>
        </div>

        <div className="mt-2">
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
