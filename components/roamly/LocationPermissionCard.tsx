"use client";

type LocationPermissionCardProps = {
  onEnable: () => void;
  busy?: boolean;
  error?: string;
  compact?: boolean;
};

export function LocationPermissionCard({ onEnable, busy, error, compact }: LocationPermissionCardProps) {
  return (
    <div className={compact ? "rounded-[1.25rem] border border-ocean/20 bg-white p-4 shadow-soft" : "rounded-[1.75rem] border border-ocean/20 bg-white/95 p-5 shadow-soft"}>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Live trip sensing</p>
      <h3 className={compact ? "mt-1 text-lg font-black text-ink" : "mt-2 text-2xl font-black text-ink"}>
        Enable nearby trip help.
      </h3>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        Roamly can show nearby activities from your locked itinerary when you arrive. Your location is only used for trip features.
      </p>
      <button
        type="button"
        onClick={onEnable}
        disabled={busy}
        className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400 disabled:opacity-60"
      >
        {busy ? "Checking location..." : "Enable trip sensing"}
      </button>
      {error ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </div>
  );
}
