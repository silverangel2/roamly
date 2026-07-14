type RoamlyGeneratingLoaderProps = {
  className?: string;
};

const startupSteps = [
  "Preparing your trip",
  "Creating the trip outline",
  "Starting day-by-day generation"
];

export function RoamlyGeneratingLoader({ className = "" }: RoamlyGeneratingLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full overflow-visible rounded-[1.25rem] border border-white/80 bg-white px-4 py-5 text-ink shadow-[0_24px_70px_rgba(15,32,51,0.18)] sm:px-6 sm:py-6 ${className}`}
    >
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Starting generation</p>
      <h2 className="mt-2 text-2xl font-black leading-tight text-ink sm:text-3xl">
        Your itinerary is being built.
      </h2>
      <p className="mt-3 text-base font-black leading-7 text-slate-700">
        The trip page will open with live progress as soon as the background job starts.
      </p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        You do not need to look for a next step here.
      </p>
      <div className="mt-4 grid gap-2">
        {startupSteps.map((step) => (
          <div
            key={step}
            className="flex min-w-0 items-center gap-3 rounded-2xl border border-ocean/15 bg-ocean/5 px-3 py-2 text-sm font-black text-ocean"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ocean" />
            <span className="min-w-0">{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
