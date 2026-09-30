// P2-2: streaming skeleton for the heavy trip dashboard route.
export default function TripLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl animate-pulse px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading trip"
    >
      <div className="h-9 w-2/3 rounded-2xl bg-slate-200" />
      <div className="mt-3 h-5 w-1/3 rounded-xl bg-slate-200" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="h-64 rounded-[1.5rem] bg-slate-200" />
        <div className="h-64 rounded-[1.5rem] bg-slate-200" />
      </div>
      <div className="mt-4 h-40 rounded-[1.5rem] bg-slate-200" />
      <span className="sr-only">Loading your trip…</span>
    </div>
  );
}
