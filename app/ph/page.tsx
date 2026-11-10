import type { Metadata } from "next";
import Link from "next/link";
import PhSkyScene from "@/components/roamly/PhSkyScene";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { createMapLink } from "@/lib/itinerary";
import {
  PHILIPPINES_AREAS,
  PH_PACK_VERIFIED_AT,
  buildPhilippinesSampleItinerary,
  formatPeso,
  philippinesPlanHref,
  type PhActivitySeed
} from "@/lib/roamly/philippinesPack";

export const metadata: Metadata = {
  title: "Roamly Philippines — Plan a trip home, or around the Philippines",
  description:
    "Roamly's Philippines door: Manila, Boracay, Palawan, Cebu + Bohol, Siargao, Baguio, and Davao + Samal — every stop a real place with checked map coordinates, priced in pesos.",
  alternates: { canonical: "https://roamlyhq.com/ph" },
  openGraph: {
    title: "Roamly Philippines — plan the trip home",
    description:
      "Day-by-day Philippines itineraries built from real places with checked coordinates, with peso estimates and travel-day messages from the Live Companion.",
    url: "https://roamlyhq.com/ph",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

function coordinatesLabel(activity: PhActivitySeed): string | null {
  const coords = activity.coordinates as { latitude?: unknown; longitude?: unknown } | null | undefined;
  if (!coords || typeof coords.latitude !== "number" || typeof coords.longitude !== "number") return null;
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
}

function ActivityRow({ activity }: { activity: PhActivitySeed }) {
  const coords = coordinatesLabel(activity);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-chair py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-bold text-chead">
          <span className="mr-2 text-xs font-extrabold text-cblue">{activity.time_label}</span>
          {activity.title}
        </p>
        <p className="mt-0.5 text-xs font-semibold leading-5 text-cgray">
          {activity.location_name}
          {coords ? <span className="text-cgray2"> · {coords}</span> : null}
          {" · "}
          <a
            href={createMapLink(activity.map_query)}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-cblue underline decoration-cblue/40 underline-offset-2 hover:text-cnavy"
          >
            Map
          </a>
        </p>
      </div>
      <p className="shrink-0 text-sm font-black text-chead">
        {activity.estimated_cost === 0 ? "Free" : formatPeso(activity.estimated_cost)}
        {activity.estimated_cost ? <span className="ml-1 text-[0.65rem] font-bold uppercase tracking-wide text-cgray2">est.</span> : null}
      </p>
    </li>
  );
}

export default function PhilippinesPage() {
  const sample = buildPhilippinesSampleItinerary("cebu-bohol", 5);
  const sampleTotal = sample.daily_itinerary.reduce(
    (sum, day) => sum + day.live_timeline.reduce((inner, item) => inner + (item.estimated_cost ?? 0), 0),
    0
  );

  return (
    <div className="safe-bottom bg-cbg text-cink">
      <section className="relative isolate mx-auto w-full max-w-5xl px-4 pb-4 pt-10 sm:px-8 sm:pt-14">
        <PhSkyScene />
        <div className="relative z-10">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Roamly · Philippines</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl">
          Plan the Philippines, place by place.
        </h1>
        <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-cink">
          Coming home, or seeing your own country properly for the first time? Roamly now plans the Philippines the way it
          plans everywhere — day by day, around your budget — with one difference: every stop below is a real place whose
          coordinates we checked against map records, priced in pesos — and on travel days, the Live Companion
          sends timely messages and points out what is near when you open Roamly.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <BuiButtonLink href={philippinesPlanHref("Cebu City, Philippines")}>Plan a trip home</BuiButtonLink>
          <BuiButtonLink href={philippinesPlanHref("Boracay, Philippines")} variant="secondary">
            Plan Boracay
          </BuiButtonLink>
          <BuiButtonLink href={philippinesPlanHref("El Nido, Philippines")} variant="secondary">
            Plan Palawan
          </BuiButtonLink>
        </div>
        <p className="mt-4 text-xs font-semibold leading-5 text-cgray">
          Prices shown are per-person planning estimates in Philippine pesos (₱) — always verify before you book. Place
          coordinates checked {PH_PACK_VERIFIED_AT} against Google Places listings.
        </p>
        </div>
      </section>

      {PHILIPPINES_AREAS.map((area) => (
        <section key={area.key} id={area.key} className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
          <BuiCard className="p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-cblue">{area.region}</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-chead">{area.displayName}</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-cink">{area.tagline}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {area.planLinks.map((link) => (
                  <BuiButtonLink key={link.plannerLabel} href={philippinesPlanHref(link.plannerLabel)} size="small">
                    {link.label}
                  </BuiButtonLink>
                ))}
              </div>
            </div>

            {area.festivalHook ? (
              <div className="mt-4 rounded-2xl bg-sun/15 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-chead">
                  {area.festivalHook.name} · {area.festivalHook.when}
                </p>
                <p className="mt-1 text-sm font-semibold leading-6 text-cink">{area.festivalHook.note}</p>
              </div>
            ) : null}

            <ul className="mt-4">
              {area.activities.map((activity) => (
                <ActivityRow key={activity.google_place_id} activity={activity} />
              ))}
            </ul>

            <p className="mt-4 text-xs font-semibold leading-5 text-cgray">
              <span className="font-black text-cink">Season notes — general patterns, not promises:</span>{" "}
              {area.seasonNote}
            </p>
          </BuiCard>
        </section>
      ))}

      <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
        <div className="rounded-bui-panel bg-cnavy p-5 text-white sm:p-7">
          <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-csoft">Sample · built from the pack</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Five days in Cebu + Bohol</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-white/75">
            This sample was generated by Roamly&apos;s own itinerary builder using only the verified Philippines pack —
            no placeholders, every stop mapped. Estimated activity total:{" "}
            <span className="font-black text-white">{formatPeso(sampleTotal)}</span> per person.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {sample.daily_itinerary.map((day) => (
              <div key={day.day_number} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-csoft">
                  Day {day.day_number}
                  {day.date ? ` · ${day.date}` : ""}
                </p>
                <ul className="mt-2 space-y-2.5">
                  {day.live_timeline.map((item, index) => (
                    <li key={`${day.day_number}-${index}`} className="text-sm">
                      <span className="font-bold text-white">
                        {item.time_label} — {item.title}
                      </span>
                      <span className="block text-xs font-semibold leading-5 text-white/75">
                        {item.location_name} ·{" "}
                        {item.packageIncluded
                          ? `Included in ${item.packageName ?? "tour package"}`
                          : item.estimated_cost === 0
                            ? "Free"
                            : `${formatPeso(item.estimated_cost)} est.`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <BuiButtonLink href={philippinesPlanHref("Cebu City, Philippines")}>Make it yours in the planner</BuiButtonLink>
            <p className="mt-3 text-xs font-semibold leading-5 text-white/75">
              Starting from a sample builds a fresh trip from Roamly&apos;s places — the sample&apos;s exact stops aren&apos;t carried over.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
        <h2 className="mt-1 text-2xl font-black tracking-tight text-chead">What it costs</h2>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-cink">
          Your first itinerary is free, one per account. After that, for Philippines trips: Full Itinerary{" "}
          <strong className="font-bold text-chead">₱99</strong>, Live Trip Companion{" "}
          <strong className="font-bold text-chead">₱79</strong>, Complete Trip Pack{" "}
          <strong className="font-bold text-chead">₱149</strong>. One-time each, tax included, no subscription.
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-12 pt-2 sm:px-8">
        <p className="text-xs font-semibold leading-5 text-cgray">
          Flights and hotels for these trips book through Roamly&apos;s usual partner links inside the planner — flights via
          Travelpayouts (Aviasales), stays via Stay22, activities via Klook where a partner link exists. Roamly has no
          direct Agoda program yet, so Agoda links here would earn nothing — we don&apos;t show any until they do.{" "}
          <Link href="/plan" className="font-bold text-cblue underline decoration-cblue/40 underline-offset-2">
            Open the planner
          </Link>
        </p>
      </section>
    </div>
  );
}
