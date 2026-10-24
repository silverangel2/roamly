import type { Metadata } from "next";
import Link from "next/link";
import PhSkyScene from "@/components/roamly/PhSkyScene";
import { Button } from "@/components/ui/Button";
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
    "Roamly's Philippines door: Manila, Boracay, Palawan, Cebu + Bohol, Siargao, Baguio, and Davao + Samal — every stop a real, map-verified place, priced in pesos.",
  openGraph: {
    title: "Roamly Philippines — plan the trip home",
    description:
      "Day-by-day Philippines itineraries built from verified places, with peso estimates and a Live Companion that knows where everything is.",
    url: "https://roamlyhq.com/ph",
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
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#e7eee4] py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">
          <span className="mr-2 text-xs font-extrabold text-[#0f6e66]">{activity.time_label}</span>
          {activity.title}
        </p>
        <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-500">
          {activity.location_name}
          {coords ? <span className="text-slate-400"> · {coords}</span> : null}
          {" · "}
          <a
            href={createMapLink(activity.map_query)}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-[#0f6e66] underline decoration-[#b8d6ca] underline-offset-2 hover:text-[#0e605a]"
          >
            Map
          </a>
        </p>
      </div>
      <p className="shrink-0 text-sm font-black text-ink">
        {activity.estimated_cost === 0 ? "Free" : formatPeso(activity.estimated_cost)}
        {activity.estimated_cost ? <span className="ml-1 text-[0.65rem] font-bold uppercase tracking-wide text-slate-400">est.</span> : null}
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
    <div className="safe-bottom bg-[#f7f7ee] text-ink">
      <section className="relative isolate mx-auto w-full max-w-5xl px-4 pb-4 pt-10 sm:px-8 sm:pt-14">
        <PhSkyScene />
        <div className="relative z-10">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0f6e66]">Roamly · Philippines</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl">
          Plan the Philippines, place by verified place.
        </h1>
        <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-600">
          Coming home, or seeing your own country properly for the first time? Roamly now plans the Philippines the way it
          plans everywhere — day by day, around your budget — with one difference: every stop below is a real place we
          verified on the map, priced in pesos, so the Live Companion can actually walk with you.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href={philippinesPlanHref("Cebu City, Philippines")}>Plan a trip home</Button>
          <Button href={philippinesPlanHref("Boracay, Philippines")} tone="secondary">
            Plan Boracay
          </Button>
          <Button href={philippinesPlanHref("El Nido, Philippines")} tone="secondary">
            Plan Palawan
          </Button>
        </div>
        <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
          Prices shown are per-person planning estimates in Philippine pesos (₱) — always verify before you book. Place
          data verified {PH_PACK_VERIFIED_AT} through Google Places.
        </p>
        </div>
      </section>

      {PHILIPPINES_AREAS.map((area) => (
        <section key={area.key} id={area.key} className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
          <div className="rounded-[1.5rem] border border-[#dfe9dc] bg-white/90 p-5 shadow-[0_14px_40px_rgba(39,88,80,0.06)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-[#0f6e66]">{area.region}</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">{area.displayName}</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{area.tagline}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {area.planLinks.map((link) => (
                  <Button key={link.plannerLabel} href={philippinesPlanHref(link.plannerLabel)} className="min-h-10 px-4 text-xs">
                    {link.label}
                  </Button>
                ))}
              </div>
            </div>

            {area.festivalHook ? (
              <div className="mt-4 rounded-2xl bg-[#fff6e8] px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#a65d32]">
                  {area.festivalHook.name} · {area.festivalHook.when}
                </p>
                <p className="mt-1 text-sm font-semibold leading-6 text-[#6b4a2a]">{area.festivalHook.note}</p>
              </div>
            ) : null}

            <ul className="mt-4">
              {area.activities.map((activity) => (
                <ActivityRow key={activity.google_place_id} activity={activity} />
              ))}
            </ul>

            <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
              <span className="font-black text-slate-600">Season notes — general patterns, not promises:</span>{" "}
              {area.seasonNote}
            </p>
          </div>
        </section>
      ))}

      <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
        <div className="rounded-[1.5rem] bg-[#173d40] p-5 text-white sm:p-7">
          <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-[#9fd8c9]">Sample · built from the pack</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Five days in Cebu + Bohol</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[#cfe5d8]">
            This sample was generated by Roamly&apos;s own itinerary builder using only the verified Philippines pack —
            no placeholders, every stop mapped. Estimated activity total:{" "}
            <span className="font-black text-white">{formatPeso(sampleTotal)}</span> per person.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {sample.daily_itinerary.map((day) => (
              <div key={day.day_number} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#9fd8c9]">
                  Day {day.day_number}
                  {day.date ? ` · ${day.date}` : ""}
                </p>
                <ul className="mt-2 space-y-2.5">
                  {day.live_timeline.map((item, index) => (
                    <li key={`${day.day_number}-${index}`} className="text-sm">
                      <span className="font-bold text-white">
                        {item.time_label} — {item.title}
                      </span>
                      <span className="block text-xs font-semibold leading-5 text-[#cfe5d8]">
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
            <Button href={philippinesPlanHref("Cebu City, Philippines")}>Make it yours in the planner</Button>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
        <h2 className="mt-1 text-2xl font-black tracking-tight">What it costs</h2>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
          Your first itinerary is free, one per account. After that, for Philippines trips: Full Itinerary{" "}
          <strong className="font-bold text-ink">₱99</strong>, Live Trip Companion{" "}
          <strong className="font-bold text-ink">₱79</strong>, Complete Trip Pack{" "}
          <strong className="font-bold text-ink">₱149</strong>. One-time each, tax included, no subscription.
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-12 pt-2 sm:px-8">
        <p className="text-xs font-semibold leading-5 text-slate-500">
          Flights and hotels for these trips book through Roamly&apos;s usual partner links inside the planner — flights via
          Travelpayouts (Aviasales), stays via Stay22, activities via Klook where a partner link exists. Roamly has no
          direct Agoda program yet, so Agoda links here would earn nothing — we don&apos;t show any until they do.{" "}
          <Link href="/plan" className="font-bold text-[#0f6e66] underline decoration-[#b8d6ca] underline-offset-2">
            Open the planner
          </Link>
        </p>
      </section>
    </div>
  );
}
