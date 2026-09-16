import Link from "next/link";
import type { ExploreCandidate } from "@/lib/roamly/exploreViewModel";

export function ExploreDiscovery({
  tripId,
  candidates
}: {
  tripId: string;
  candidates: ExploreCandidate[];
}) {
  return (
    <main className="safe-bottom min-h-[calc(100dvh-5rem)] bg-[#fbf8ef] px-4 pb-24 pt-5 text-ink sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="border-b border-[#e8dfd0] pb-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">For this trip</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Worth considering</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
            A short list of grounded ideas that fit the trip. Nothing is added unless you choose it.
          </p>
        </header>

        {candidates.length ? (
          <section className="mt-6" aria-labelledby="explore-results-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Curated for your trip</p>
                <h2 id="explore-results-heading" className="mt-1 text-2xl font-black tracking-tight">Start with these</h2>
              </div>
              <span className="text-xs font-black text-slate-400">{candidates.length} options</span>
            </div>

            <div className="mt-4 divide-y divide-[#e8dfd0] border-y border-[#e8dfd0]">
              {candidates.map((candidate, index) => (
                <article key={candidate.id} className="py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className={`text-xs font-black uppercase tracking-[0.14em] ${index === 0 ? "text-ocean" : "text-slate-400"}`}>{index === 0 ? "Best fit for this trip" : candidate.evidenceLabel}</p>
                      </div>
                      <h3 className="mt-1 text-lg font-black text-ink">{candidate.title}</h3>
                      <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-700">{candidate.reason}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-500">
                    {candidate.date ? <span>{candidate.date}</span> : null}
                    {candidate.time ? <span>{candidate.time}</span> : null}
                    {candidate.duration ? <span>{candidate.duration}</span> : null}
                    {candidate.location ? <span>{candidate.location}</span> : null}
                    {candidate.priceLabel ? <span>{candidate.priceLabel}</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    {candidate.href ? (
                      <a href={candidate.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white">
                        View details
                      </a>
                    ) : null}
                    {candidate.publicEvent ? <span className="text-xs font-bold text-slate-500">Public event details may change; verify the organizer&apos;s page.</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="mt-8 border-y border-dashed border-[#e8dfd0] py-7">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Explore is intentionally quiet</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Not enough grounded discoveries yet</h2>
            <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-slate-600">
              Roamly does not have enough trip-specific activity or event evidence to recommend something responsibly for these dates.
            </p>
            <Link href={`/trip/${tripId}#day-by-day`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white">
              Return to your plan
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
