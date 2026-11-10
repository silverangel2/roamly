"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BuiCard } from "@/components/boardui/Card";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiNotice } from "@/components/boardui/Notice";
import { BuiFieldError } from "@/components/boardui/Field";
import {
  GUEST_ACCOUNT_WALL,
  GUEST_FLIGHT_SEARCH_CTA,
  GUEST_FREE_ITINERARY_DISCLAIMER,
  GUEST_NO_FLIGHTS_TEXT,
  type GuestBookingCard,
  type GuestItineraryDayView,
  type GuestItineraryStatus
} from "@/lib/roamly/guestItineraryView";
import {
  guestGenerationStatusLines,
  type GuestGenerationStatus
} from "@/lib/roamly/guestGenerationStatus";
import {
  packBuildStatusLines,
  type PackBuildStatus
} from "@/lib/roamly/packBuildStatus";
import { presentDayHeading, presentTravelerTitle, punctuateTravelerTime } from "@/lib/roamly/itineraryPresentation";

const PLAN_RESUME_PATH = "/plan?resumePlan=1&continueGenerate=1";

type GuestItineraryResponse = {
  ok: true;
  title: string;
  summary: string;
  disclaimer: string;
  flightSearchUrl?: string | null;
  status: GuestItineraryStatus;
  days: GuestItineraryDayView[];
  stays: GuestBookingCard[];
  flights: GuestBookingCard[];
  experiences: GuestBookingCard[];
  essentials: GuestBookingCard[];
  generationStatus?: GuestGenerationStatus;
  packBuild?: PackBuildStatus | null;
  deliveryEmail?: string | null;
};

function BookingCardList({ cards }: { cards: GuestBookingCard[] }) {
  if (!cards.length) return null;
  return (
    <ul className="mt-3 grid gap-2">
      {cards.map((card) => (
        <li key={`${card.title}-${card.url}`}>
          <BuiCard className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black leading-5 text-chead">{presentTravelerTitle({ title: card.title, category: card.title }).title}</p>
                {card.detail ? <p className="mt-1 text-xs font-semibold leading-5 text-cgray">{card.detail}</p> : null}
                <p className="mt-1 text-xs font-bold text-cgray">
                  {card.priceLabel ? <span className="text-cblue">{card.priceLabel}</span> : null}
                  {card.priceLabel && card.provider ? " · " : null}
                  {card.provider ? <span>{card.provider}</span> : null}
                </p>
              </div>
              <BuiButtonLink
                href={card.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                size="small"
                className="shrink-0"
              >
                {card.ctaLabel}
              </BuiButtonLink>
            </div>
          </BuiCard>
        </li>
      ))}
    </ul>
  );
}

function planAuthUrl(pathname: "/login" | "/signup") {
  return `${pathname}?next=${encodeURIComponent(PLAN_RESUME_PATH)}`;
}

// Clock time in the traveler's own locale for the pack-wait outer bound
// (e.g. "2:35 PM"). Returns null for a missing or unparseable deadline, and
// the status lines then fall back to the outer-bound duration in words.
function formatDeadlineLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

export function GuestFreeItinerary() {
  const { translateText } = useI18n();
  const [itinerary, setItinerary] = useState<GuestItineraryResponse | null>(null);
  const [error, setError] = useState("");
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [deliveryEmail, setDeliveryEmail] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);

  async function saveDeliveryEmail() {
    const email = emailDraft.trim();
    if (!email || emailSaving) return;
    setEmailSaving(true);
    setEmailError("");
    try {
      const response = await fetch("/api/trips/guest-itinerary/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setEmailError(
          typeof data?.message === "string" && data.message
            ? data.message
            : "That email couldn't be saved — check it and try again."
        );
        return;
      }
      setDeliveryEmail(typeof data.deliveryEmail === "string" ? data.deliveryEmail : email);
    } catch {
      setEmailError("That email couldn't be saved — check it and try again.");
    } finally {
      setEmailSaving(false);
    }
  }

  async function requestRecovery() {
    const email = recoveryEmail.trim();
    if (!email || recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      await fetch("/api/trips/guest-itinerary/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email })
      }).catch(() => null);
      // The endpoint answers the same line whether or not the email
      // holds a trip, so this confirmation never leaks existence.
      setRecoverySent(true);
    } finally {
      setRecoveryBusy(false);
    }
  }

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    // EGRESS DIET (F1b): unchanged-progress backoff, same law as the
    // member generation poller — the base 3 s cadence is untouched,
    // but when completedDayCount has not moved, the delay doubles up
    // to a 30 s cap; any movement (or a status change) resets it
    // instantly. Implemented with closure state only, so the effect
    // still mounts exactly once.
    let lastProgressKey: string | null = null;
    let unchangedPolls = 0;

    async function load() {
      const response = await fetch("/api/trips/guest-itinerary", { credentials: "same-origin" });
      const data = await response.json().catch(() => null);
      if (stopped) return;
      if (!response.ok || !data?.ok) {
        setItinerary(null);
        setNeedsRecovery(response.status === 401);
        setError(response.status === 401 ? "Start a free itinerary from the plan page." : "Your free itinerary could not be loaded.");
        return;
      }
      setError("");
      setNeedsRecovery(false);
      setDeliveryEmail(typeof data.deliveryEmail === "string" && data.deliveryEmail ? data.deliveryEmail : null);
      // Older API responses may not include the booking sections; default them
        flightSearchUrl: typeof data.flightSearchUrl === "string" && data.flightSearchUrl ? data.flightSearchUrl : null,
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
      if (data.status === "building") {
        const progressKey = `${data.status}:${data.generationStatus?.completedDayCount ?? ""}:${data.generationStatus?.phase ?? ""}`;
        if (progressKey === lastProgressKey) {
          unchangedPolls += 1;
        } else {
          lastProgressKey = progressKey;
          unchangedPolls = 0;
        }
        const backoffMs = Math.min(30000, 3000 * 2 ** Math.max(0, unchangedPolls - 1));
        timer = window.setTimeout(load, backoffMs);
      }
    }

    void load();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const generationLines = itinerary?.generationStatus
    ? guestGenerationStatusLines(
        itinerary.generationStatus,
        formatDeadlineLabel(itinerary.generationStatus.packWaitDeadlineAt)
      )
    : null;

  // Pack-build state, read-only from existing pack rows (incident
  // 2026-10-25, stream 2). Ready needs no line; any other recorded
  // state gets one honest line, and "no pack row exists" is said
  // plainly instead of being hidden behind the generation spinner.
  const packBuild = itinerary?.packBuild ?? itinerary?.generationStatus?.packBuild ?? null;
  const packLines = packBuild ? packBuildStatusLines(packBuild, itinerary?.generationStatus?.destination ?? null) : null;

  return (
    <BuiCard data-guest-free-itinerary className="p-4 sm:p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Free itinerary")}</p>
      <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-chead sm:text-3xl">
        {itinerary?.title || translateText("Your free itinerary")}
      </h2>
      {itinerary ? <p className="mt-2 text-sm font-bold leading-6 text-cgray">{itinerary.summary}</p> : null}
      <p className="mt-3 text-sm font-black leading-6 text-chead">{translateText(itinerary?.disclaimer || GUEST_FREE_ITINERARY_DISCLAIMER)}</p>

      {error ? <BuiNotice tone="error" title={translateText(error)} className="mt-4" /> : null}
      {needsRecovery ? (
        <div data-guest-recovery className="mt-4 rounded-bui-panel border border-chair bg-csoft p-4">
          <p className="text-sm font-black leading-6 text-chead">
            {translateText("Lost this trip? Enter the email you gave us and we'll send you a link to get it back.")}
          </p>
          {recoverySent ? (
            <p className="mt-2 text-sm font-semibold leading-6 text-cgray">
              {translateText("If that email has a free itinerary, a link is on its way to it.")}
            </p>
          ) : (
            <div className="mt-3">
              {/* Form Rules pass (2026-11-03), rule 1: this field's only
                  label was its placeholder ("Email") — the moment the
                  traveller started typing, nothing named the field. It
                  now carries a persistent label; the placeholder is
                  demoted to an example address. */}
              <label htmlFor="guest-recovery-email" className="text-sm font-black text-chead">
                {translateText("Email")}
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="guest-recovery-email"
                  type="email"
                  value={recoveryEmail}
                  onChange={(event) => setRecoveryEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="bui-input min-h-12 flex-1 rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10"
                />
                <BuiButton
                  type="button"
                  busy={recoveryBusy}
                  disabled={!recoveryEmail.trim()}
                  onClick={() => void requestRecovery()}
                >
                  {translateText(recoveryBusy ? "Sending…" : "Send me the link")}
                </BuiButton>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {!itinerary && !error ? <p className="mt-4 text-sm font-bold leading-6 text-cgray">{translateText("Loading your free itinerary...")}</p> : null}
      {itinerary?.status === "building" ? (
        <div className="mt-4">
          {generationLines ? (
            <>
              <p className="text-sm font-bold leading-6 text-cgray">{translateText(generationLines.headline)}</p>
              {generationLines.detail ? (
                <p className="mt-1 text-sm font-semibold leading-6 text-cgray">{translateText(generationLines.detail)}</p>
              ) : null}
              {generationLines.estimate ? (
                <p className="mt-1 text-sm font-semibold leading-6 text-cgray">{translateText(generationLines.estimate)}</p>
              ) : null}
              {packLines ? (
                <p className="mt-1 text-sm font-semibold leading-6 text-cgray">{translateText(packLines.headline)}</p>
              ) : null}
              {packLines?.detail ? (
                <p className="mt-1 text-sm font-semibold leading-6 text-cgray">{translateText(packLines.detail)}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm font-bold leading-6 text-cgray">
              {translateText("Roamly is building your free itinerary. Completed days appear here as they are ready.")}
            </p>
          )}
        </div>
      ) : null}
      {itinerary?.status === "failed" ? (
        <div className="mt-4">
          <p className="text-sm font-bold leading-6 text-cgray">
            {translateText("Roamly could not finish this free itinerary.")}
          </p>
          {generationLines?.detail ? (
            <p className="mt-1 text-sm font-semibold leading-6 text-cgray">{translateText(generationLines.detail)}</p>
          ) : null}
          {packLines ? (
            <p className="mt-1 text-sm font-semibold leading-6 text-cgray">{translateText(packLines.headline)}</p>
          ) : null}
          {packLines?.detail ? (
            <p className="mt-1 text-sm font-semibold leading-6 text-cgray">{translateText(packLines.detail)}</p>
          ) : null}
        </div>
      ) : null}

      {itinerary?.days.length ? (
        <div className="mt-5 grid gap-3">
          {itinerary.days.map((day) => {
            // Index of the last timeline row that will actually render —
            // the rail's connector line stops there.
            const lastTimelineIndex = day.timeline.reduce(
              (acc, item, index) => (presentTravelerTitle({ title: item.title, category: item.title }).title.trim() ? index : acc),
              -1
            );
            return (
            <article key={day.dayNumber} className="rounded-bui-panel bg-cbg p-4">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-cgray">
                {translateText("Day")} {day.dayNumber}
                {day.date ? ` · ${day.date}` : ""}
              </p>
              {(() => {
                // Round 2 HIGH 3: merged day titles render as one heading
                // per venue; an unconfident join renders no venue heading.
                const headings = day.title ? presentDayHeading({ title: day.title, category: "activity" }).headings : [];
                return headings.map((heading) => (
                  <h3 key={heading} className="mt-1 text-lg font-black text-chead">{heading}</h3>
                ));
              })()}
              {day.morning ? <p className="mt-3 text-sm font-semibold leading-6 text-cink"><span className="font-black text-chead">{translateText("Morning")}. </span>{day.morning}</p> : null}
              {day.afternoon ? <p className="mt-2 text-sm font-semibold leading-6 text-cink"><span className="font-black text-chead">{translateText("Afternoon")}. </span>{day.afternoon}</p> : null}
              {day.evening ? <p className="mt-2 text-sm font-semibold leading-6 text-cink"><span className="font-black text-chead">{translateText("Evening")}. </span>{day.evening}</p> : null}
              {day.food.length ? <p className="mt-2 text-sm font-semibold leading-6 text-cink"><span className="font-black text-chead">{translateText("Food")}. </span>{day.food.join(", ")}</p> : null}
              {day.timeline.length ? (
                <ul className="mt-4 grid">
                  {day.timeline.map((item, itemIndex) => {
                    // A time with no displayable activity is noise, not a plan
                    // line: the traveler saw bare "14:31 – 14:34." rows. Skip
                    // items whose traveler-facing title is empty.
                    const displayTitle = presentTravelerTitle({ title: item.title, category: item.title }).title;
                    if (!displayTitle.trim()) return null;
                    return (
                    <li key={`${day.dayNumber}-${item.time}-${item.title}`} className="relative flex gap-3 pb-3 last:pb-0">
                      <span className="w-20 shrink-0 whitespace-nowrap text-sm font-bold leading-6 text-chead">
                        {item.time ? punctuateTravelerTime(item.time) : ""}
                      </span>
                      <span aria-hidden="true" className="relative w-3 shrink-0">
                        <span className="absolute left-1/2 top-[7px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cblue" />
                        {itemIndex < lastTimelineIndex ? (
                          <span className="absolute -bottom-3 left-1/2 top-[19px] w-px -translate-x-1/2 bg-chair" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-semibold leading-6 text-cink">
                        {item.bookingUrl ? (
                          <a
                            href={item.bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer sponsored"
                            className="font-black text-cblue underline decoration-cblue/30 underline-offset-4"
                          >
                            {displayTitle}
                            {item.bookingLabel ? ` · ${item.bookingLabel}` : ""}
                          </a>
                        ) : (
                          displayTitle
                        )}
                      </span>
                    </li>
                    );
                  })}
                </ul>
              ) : null}
            </article>
            );
          })}
        </div>
      ) : null}

      {/* Delivery email at day-1-ready (owner law, 2026-10-24): the free
          itinerary generates first; the moment day 1 is viewable, ask
          where to send the rest. Never before generation starts, and
          never while nothing is viewable yet. */}
      {itinerary && itinerary.days.length >= 1 ? (
        deliveryEmail ? (
          <p data-guest-delivery-saved className="mt-5 text-sm font-semibold leading-6 text-cgray">
            {translateText("We'll send the rest to")} {deliveryEmail}.
          </p>
        ) : (
          <div data-guest-delivery-email className="mt-5 rounded-bui-panel border border-chair bg-csoft p-4">
            <p className="text-sm font-black leading-6 text-chead">{translateText("Where do I send the rest?")}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-cgray">
              {translateText("Day 1 is ready. Leave your email and we'll send the rest of this itinerary to you — and you can get this trip back if you switch browsers.")}
            </p>
            <div className="mt-3">
              {/* Form Rules pass (2026-11-03), rule 1: same defect as
                  the recovery field above — placeholder was the only
                  label. Persistent label added; placeholder demoted
                  to an example address. */}
              <label htmlFor="guest-delivery-email-address" className="text-sm font-black text-chead">
                {translateText("Email")}
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="guest-delivery-email-address"
                  type="email"
                  value={emailDraft}
                  onChange={(event) => setEmailDraft(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-describedby="guest-delivery-email-error"
                  aria-invalid={emailError ? true : undefined}
                  className="bui-input min-h-12 flex-1 rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10"
                />
                <BuiButton
                  type="button"
                  busy={emailSaving}
                  disabled={!emailDraft.trim()}
                  onClick={() => void saveDeliveryEmail()}
                >
                  {translateText(emailSaving ? "Saving…" : "Send the rest to me")}
                </BuiButton>
              </div>
            </div>
            <BuiFieldError id="guest-delivery-email-error" message={emailError ? translateText(emailError) : ""} />
          </div>
        )
      ) : null}

      {itinerary?.status === "ready" && (itinerary.stays.length > 0 || itinerary.flights.length > 0 || itinerary.flightSearchUrl || itinerary.experiences.length > 0 || itinerary.essentials.length > 0) ? (
        <div className="mt-6 grid gap-4">
          {itinerary.stays.length ? (
            <section className="rounded-bui-panel bg-cbg p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Where to stay")}</p>
              <h3 className="mt-1 text-lg font-black text-chead">{translateText("Stay picks matched to your budget")}</h3>
              <BookingCardList cards={itinerary.stays} />
            </section>
          ) : null}
          {itinerary.flights.length ? (
            <section className="rounded-bui-panel bg-cbg p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Flights & getting there")}</p>
              <h3 className="mt-1 text-lg font-black text-chead">{translateText("Best flight and cheaper ways there")}</h3>
              <BookingCardList cards={itinerary.flights} />
            </section>
          ) : itinerary.flightSearchUrl ? (
            <section className="rounded-bui-panel bg-cbg p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Flights & getting there")}</p>
              <h3 className="mt-1 text-lg font-black text-chead">{translateText(GUEST_NO_FLIGHTS_TEXT)}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-cgray">
                {translateText("Roamly didn't find flight options for this trip. Search current flights yourself — nothing here is booked or priced.")}
              </p>
              <BuiButtonLink
                href={itinerary.flightSearchUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                size="small"
                className="mt-3"
              >
                {translateText(GUEST_FLIGHT_SEARCH_CTA)}
              </BuiButtonLink>
            </section>
          ) : null}
          {itinerary.experiences.length ? (
            <section className="rounded-bui-panel bg-cbg p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Experiences")}</p>
              <h3 className="mt-1 text-lg font-black text-chead">{translateText("Bookable experiences for your interests")}</h3>
              <BookingCardList cards={itinerary.experiences} />
            </section>
          ) : null}
          {itinerary.essentials.length ? (
            <section className="rounded-bui-panel bg-cbg p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Travel essentials")}</p>
              <h3 className="mt-1 text-lg font-black text-chead">{translateText("Amazon finds for your trip")}</h3>
              <BookingCardList cards={itinerary.essentials} />
            </section>
          ) : null}
          <p className="text-xs font-semibold leading-5 text-cgray">
            {translateText("Booking links may earn Roamly a commission at no extra cost to you. Prices and availability change — verify before booking.")}
          </p>
        </div>
      ) : null}

      {itinerary?.status === "ready" && itinerary.days.length > 0 ? (
        <>
          <BuiCard data-guest-live-companion-offer className="mt-6 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Live Companion")}</p>
            <h3 className="mt-2 text-lg font-black text-chead">{translateText("Add Live Companion")}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-cgray">
              {translateText("Pre-trip reminders, a booking timeline, and up-next help for this trip. This is an offer only. Nothing is unlocked yet. Live Companion needs an account — sign in to add it.")}
            </p>
            <BuiButtonLink
              href={planAuthUrl("/login")}
              variant="secondary"
              className="mt-4"
            >
              {translateText("Add Live Companion")}
            </BuiButtonLink>
          </BuiCard>
          <div data-guest-account-wall className="mt-4 rounded-bui-panel border border-chair bg-csoft p-4">
            <p className="text-sm font-black leading-6 text-chead">
              {translateText("Sign in to save this itinerary, purchase Live Companion, or buy paid packs.")}
            </p>
            <ul className="mt-3 grid gap-1.5 text-sm font-semibold leading-6 text-cink">
              {GUEST_ACCOUNT_WALL.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-cblue" />
                  <span>{translateText(item)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <BuiButtonLink
                href={planAuthUrl("/login")}
              >
                {translateText("Sign in to save")}
              </BuiButtonLink>
              <BuiButtonLink
                href={planAuthUrl("/signup")}
                variant="secondary"
              >
                {translateText("Create an account")}
              </BuiButtonLink>
            </div>
          </div>
        </>
      ) : null}
      {!itinerary ? (
        <Link href="/plan" className="mt-4 inline-flex text-sm font-black text-cblue underline decoration-cblue/30 underline-offset-4">
          {translateText("Back to plan")}
        </Link>
      ) : null}
    </BuiCard>
  );
}
