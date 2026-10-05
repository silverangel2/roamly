"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  GUEST_ACCOUNT_WALL,
  GUEST_FREE_ITINERARY_DISCLAIMER,
  type GuestBookingCard,
  type GuestItineraryDayView,
  type GuestItineraryStatus
} from "@/lib/roamly/guestItineraryView";
import { presentTravelerTitle, punctuateTravelerTime } from "@/lib/roamly/itineraryPresentation";

const PLAN_RESUME_PATH = "/plan?resumePlan=1&continueGenerate=1";

type GuestItineraryResponse = {
  ok: true;
  title: string;
  summary: string;
  disclaimer: string;
  status: GuestItineraryStatus;
  days: GuestItineraryDayView[];
  stays: GuestBookingCard[];
  flights: GuestBookingCard[];
  experiences: GuestBookingCard[];
  essentials: GuestBookingCard[];
};

function BookingCardList({ cards }: { cards: GuestBookingCard[] }) {
  if (!cards.length) return null;
  return (
    <ul className="mt-3 grid gap-2">
      {cards.map((card) => (
        <li key={`${card.title}-${card.url}`} className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black leading-5 text-ink">{presentTravelerTitle({ title: card.title, category: card.title }).title}</p>
              {card.detail ? <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{card.detail}</p> : null}
              <p className="mt-1 text-xs font-bold text-slate-500">
                {card.priceLabel ? <span className="text-ocean">{card.priceLabel}</span> : null}
                {card.priceLabel && card.provider ? " · " : null}
                {card.provider ? <span>{card.provider}</span> : null}
              </p>
            </div>
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-ocean px-4 py-2 text-xs font-black text-white"
            >
              {card.ctaLabel}
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function planAuthUrl(pathname: "/login" | "/signup") {
  return `${pathname}?next=${encodeURIComponent(PLAN_RESUME_PATH)}`;
}

export function GuestFreeItinerary() {
  const { translateText } = useI18n();
  const [itinerary, setItinerary] = useState<GuestItineraryResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    async function load() {
      const response = await fetch("/api/trips/guest-itinerary", { credentials: "same-origin" });
      const data = await response.json().catch(() => null);
      if (stopped) return;
      if (!response.ok || !data?.ok) {
        setItinerary(null);
        setError(response.status === 401 ? "Start a free itinerary from the plan page." : "Your free itinerary could not be loaded.");
        return;
      }
      setError("");
      // Older API responses may not include the booking sections; default them
      // so rendering never crashes on a missing array.
      setItinerary({
        ...data,
        stays: Array.isArray(data.stays) ? data.stays : [],
        flights: Array.isArray(data.flights) ? data.flights : [],
        experiences: Array.isArray(data.experiences) ? data.experiences : [],
        essentials: Array.isArray((data as { essentials?: unknown }).essentials)
          ? (data as { essentials: GuestBookingCard[] }).essentials
          : []
      } as GuestItineraryResponse);
      if (data.status === "building") timer = window.setTimeout(load, 3000);
    }

    void load();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <section data-guest-free-itinerary className="rounded-[1.75rem] border border-cloud bg-white p-4 shadow-soft sm:p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Free itinerary")}</p>
      <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-ink sm:text-3xl">
        {itinerary?.title || translateText("Your free itinerary")}
      </h2>
      {itinerary ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{itinerary.summary}</p> : null}
      <p className="mt-3 text-sm font-black leading-6 text-ink">{translateText(itinerary?.disclaimer || GUEST_FREE_ITINERARY_DISCLAIMER)}</p>

      {error ? <p className="mt-4 text-sm font-bold leading-6 text-slate-600">{translateText(error)}</p> : null}
      {!itinerary && !error ? <p className="mt-4 text-sm font-bold leading-6 text-slate-600">{translateText("Loading your free itinerary...")}</p> : null}
      {itinerary?.status === "building" ? (
        <p className="mt-4 text-sm font-bold leading-6 text-slate-600">
          {translateText("Roamly is building your free itinerary. Completed days appear here as they are ready.")}
        </p>
      ) : null}
      {itinerary?.status === "failed" ? (
        <p className="mt-4 text-sm font-bold leading-6 text-slate-600">
          {translateText("Roamly could not finish this free itinerary.")}
        </p>
      ) : null}

      {itinerary?.days.length ? (
        <div className="mt-5 grid gap-3">
          {itinerary.days.map((day) => (
            <article key={day.dayNumber} className="rounded-2xl bg-mist p-4">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-slate-600">
                {translateText("Day")} {day.dayNumber}
                {day.date ? ` · ${day.date}` : ""}
              </p>
              {day.title ? <h3 className="mt-1 text-lg font-black text-ink">{presentTravelerTitle({ title: day.title, category: "activity" }).title}</h3> : null}
              {day.morning ? <p className="mt-3 text-sm font-semibold leading-6 text-slate-700"><span className="font-black text-ink">{translateText("Morning")}. </span>{day.morning}</p> : null}
              {day.afternoon ? <p className="mt-2 text-sm font-semibold leading-6 text-slate-700"><span className="font-black text-ink">{translateText("Afternoon")}. </span>{day.afternoon}</p> : null}
              {day.evening ? <p className="mt-2 text-sm font-semibold leading-6 text-slate-700"><span className="font-black text-ink">{translateText("Evening")}. </span>{day.evening}</p> : null}
              {day.food.length ? <p className="mt-2 text-sm font-semibold leading-6 text-slate-700"><span className="font-black text-ink">{translateText("Food")}. </span>{day.food.join(", ")}</p> : null}
              {day.timeline.length ? (
                <ul className="mt-3 grid gap-2">
                  {day.timeline.map((item) => (
                    <li key={`${day.dayNumber}-${item.time}-${item.title}`} className="text-sm font-semibold leading-6 text-slate-700">
                      {item.time ? <span className="font-black text-ink">{punctuateTravelerTime(item.time)}</span> : null}
                      {item.bookingUrl ? (
                        <a
                          href={item.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer sponsored"
                          className="font-black text-ocean underline decoration-ocean/30 underline-offset-4"
                        >
                          {presentTravelerTitle({ title: item.title, category: item.title }).title}
                          {item.bookingLabel ? ` · ${item.bookingLabel}` : ""}
                        </a>
                      ) : (
                        presentTravelerTitle({ title: item.title, category: item.title }).title
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {itinerary?.status === "ready" && (itinerary.stays.length > 0 || itinerary.flights.length > 0 || itinerary.experiences.length > 0 || itinerary.essentials.length > 0) ? (
        <div className="mt-6 grid gap-4">
          {itinerary.stays.length ? (
            <section className="rounded-2xl bg-mist p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Where to stay")}</p>
              <h3 className="mt-1 text-lg font-black text-ink">{translateText("Stay picks matched to your budget")}</h3>
              <BookingCardList cards={itinerary.stays} />
            </section>
          ) : null}
          {itinerary.flights.length ? (
            <section className="rounded-2xl bg-mist p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Flights & getting there")}</p>
              <h3 className="mt-1 text-lg font-black text-ink">{translateText("Best flight and cheaper ways there")}</h3>
              <BookingCardList cards={itinerary.flights} />
            </section>
          ) : null}
          {itinerary.experiences.length ? (
            <section className="rounded-2xl bg-mist p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Experiences")}</p>
              <h3 className="mt-1 text-lg font-black text-ink">{translateText("Bookable experiences for your interests")}</h3>
              <BookingCardList cards={itinerary.experiences} />
            </section>
          ) : null}
          {itinerary.essentials.length ? (
            <section className="rounded-2xl bg-mist p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Travel essentials")}</p>
              <h3 className="mt-1 text-lg font-black text-ink">{translateText("Amazon finds for your trip")}</h3>
              <BookingCardList cards={itinerary.essentials} />
            </section>
          ) : null}
          <p className="text-xs font-semibold leading-5 text-slate-500">
            {translateText("Booking links may earn Roamly a commission at no extra cost to you. Prices and availability change — verify before booking.")}
          </p>
        </div>
      ) : null}

      {itinerary?.status === "ready" && itinerary.days.length > 0 ? (
        <>
          <div data-guest-live-companion-offer className="mt-6 rounded-2xl border border-ocean/20 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Live Companion")}</p>
            <h3 className="mt-2 text-lg font-black text-ink">{translateText("Add Live Companion")}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {translateText("Pre-trip reminders, a booking timeline, and up-next help for this trip. This is an offer only. Nothing is unlocked yet.")}
            </p>
            <Link
              href={planAuthUrl("/login")}
              className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-ocean/30 bg-ocean/5 px-5 py-3 text-sm font-semibold text-ocean"
            >
              {translateText("Add Live Companion")}
            </Link>
          </div>
          <div data-guest-account-wall className="mt-4 rounded-2xl border border-ocean/20 bg-[#f7fbfb] p-4">
            <p className="text-sm font-black leading-6 text-ink">
              {translateText("Sign in to save this itinerary, purchase Live Companion, or buy paid packs.")}
            </p>
            <ul className="mt-3 grid gap-1 text-sm font-semibold leading-6 text-slate-600">
              {GUEST_ACCOUNT_WALL.map((item) => (
                <li key={item}>{translateText(item)}</li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                href={planAuthUrl("/login")}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-ocean px-5 py-3 text-center text-sm font-semibold text-white"
              >
                {translateText("Sign in to save")}
              </Link>
              <Link
                href={planAuthUrl("/signup")}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-cloud bg-white px-5 py-3 text-center text-sm font-semibold text-ocean"
              >
                {translateText("Create an account")}
              </Link>
            </div>
          </div>
        </>
      ) : null}
      {!itinerary ? (
        <Link href="/plan" className="mt-4 inline-flex text-sm font-black text-ocean underline decoration-ocean/30 underline-offset-4">
          {translateText("Back to plan")}
        </Link>
      ) : null}
    </section>
  );
}
