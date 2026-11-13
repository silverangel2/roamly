import { BuiButtonLink } from "@/components/boardui/Button";
import { translateExactText, translateKey } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";
import type { ExploreCandidate } from "@/lib/roamly/exploreViewModel";

/*
 * A20 (Jakob): an external exit names its destination before the tap.
 * ExploreCandidate carries NO partner/provider identity (see
 * lib/roamly/exploreViewModel.ts — no provider field exists on the
 * type), so the button names the destination place the card carries
 * (location, falling back to the candidate's title) plus the external
 * host the href actually leads to.
 */
function externalDetailsLabel(candidate: ExploreCandidate): string {
  let host = "";
  if (candidate.href) {
    try {
      host = new URL(candidate.href).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
  }
  const place = candidate.location || candidate.title;
  if (host && place) return `View details for ${place} on ${host}`;
  if (host) return `View details on ${host}`;
  return `View details for ${place}`;
}

export async function ExploreDiscovery({
  tripId,
  destination = "this destination",
  candidates
}: {
  tripId: string;
  destination?: string;
  candidates: ExploreCandidate[];
}) {
  const locale = await getServerLocale();
  return (
    <div className="min-h-[calc(100dvh-5rem)] bg-cbg px-4 pb-8 pt-5 text-chead sm:px-6 sm:py-8 md:pb-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="border-b border-chair pb-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">{translateExactText(locale, "For this trip")}</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{translateExactText(locale, "Worth considering")}</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-cink">
            {translateExactText(locale, "A short list of grounded ideas that fit the trip. Nothing is added unless you choose it.")}
          </p>
        </header>

        {candidates.length ? (
          <section className="mt-6" aria-labelledby="explore-results-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateExactText(locale, "Curated for your trip")}</p>
                <h2 id="explore-results-heading" className="mt-1 text-2xl font-black tracking-tight">{translateExactText(locale, "Start with these")}</h2>
              </div>
              <span className="text-xs font-black text-cgray2">{candidates.length} options</span>
            </div>

            <div className="mt-4 divide-y divide-chair border-y border-chair">
              {candidates.map((candidate, index) => (
                <article key={candidate.id} className="py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className={`text-xs font-black uppercase tracking-[0.14em] ${index === 0 ? "text-cblue" : "text-cgray2"}`}>{index === 0 ? translateExactText(locale, "Best fit for this trip") : candidate.evidenceLabel}</p>
                      </div>
                      <h3 className="mt-1 text-lg font-black text-chead">{candidate.title}</h3>
                      <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-cink">{candidate.reason}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-cgray">
                    {candidate.date ? <span>{candidate.date}</span> : null}
                    {candidate.time ? <span>{candidate.time}</span> : null}
                    {candidate.duration ? <span>{candidate.duration}</span> : null}
                    {candidate.location ? <span>{candidate.location}</span> : null}
                    {candidate.priceLabel ? <span>{candidate.priceLabel}</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    {candidate.href ? (
                      /* External exit (A20: the label names the host it
                         leads to) — a plain anchor with the primary
                         button recipe; BuiButtonLink is next/link and
                         stays for internal routes only. The recipe's
                         nowrap is deliberately NOT carried: the A20
                         label (place + host) is long by design and
                         wrapped inside the button before this pass —
                         it still does. */
                      <a href={candidate.href} target="_blank" rel="noreferrer" className="bui-press bui-touch inline-flex min-h-11 items-center gap-2 rounded-xl bg-cblue px-4 py-3 text-left text-sm font-semibold leading-snug text-white shadow-[0_8px_20px_rgba(8,123,255,0.25)] transition-colors duration-200 ease-bui hover:bg-[#0A6FE0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/30">
                        {externalDetailsLabel(candidate)}
                      </a>
                    ) : null}
                    {candidate.publicEvent ? <span className="text-xs font-bold text-cgray">{translateExactText(locale, "Public event details may change; verify the organizer's page.")}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="mt-8 border-y border-dashed border-chair py-7">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateExactText(locale, "Explore is intentionally quiet")}</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">{translateExactText(locale, "Not enough grounded discoveries yet")}</h2>
            <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-cink">
              {translateExactText(locale, "Roamly does not have enough trip-specific activity or event evidence to recommend something responsibly for these dates. Nothing is invented here. Check back when discoveries are ready, or open Finds for inspiration.")}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <BuiButtonLink href={`/finds?destination=${encodeURIComponent(destination)}`}>
                {translateKey(locale, "ui.trip.openFindsFor", "Open Finds for {destination}", { destination })}
              </BuiButtonLink>
              <BuiButtonLink variant="secondary" href={`/trip/${tripId}#day-by-day`}>
                {translateExactText(locale, "Return to your plan")}
              </BuiButtonLink>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
