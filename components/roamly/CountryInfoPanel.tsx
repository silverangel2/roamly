"use client";

/*
 * CountryInfoPanel — the Country Info page, Picture 2 overhaul
 * (2026-10-26) against screenshots-latest/correct-4-pages.jpg,
 * TOP-RIGHT panel, followed literally, top to bottom:
 * header (back chevron, "COUNTRY INFO" eyebrow, destination, date
 * line) → tabs Overview / Entry & Travel
 * / Transport / Safety → photo hero with weather overlay card →
 * "Key information" grid (icon + label + value lines, six cells) →
 * "Travel notes for this trip" checklist card → full-width
 * "See full itinerary" button. The content ENDS there; the app tab
 * bar is shell chrome and stays.
 *
 * What the picture does NOT show does NOT appear on this screen:
 * no "From {origin}" line under the header (removed in this
 * overhaul — origin now appears only via the Entry & Travel route
 * line and the trip's own records), no summary paragraph under the
 * Overview notes, and no standalone weather paragraph when there is
 * no photo (bare header). One deliberate exception, flagged in the
 * Picture 2 report: the discreet "Photo:" credit under a real photo
 * is kept, because the picture's photo is a mock with no licence
 * while this screen's photos are real Wikimedia Commons photos
 * whose credit the other surfaces also show.
 *
 * This component renders ONLY the model it is given (built server-side
 * from the trip's own record). It invents nothing: a grid cell with no
 * value renders its unavailable text; the weather overlay always
 * renders its unavailable state (no feed is configured — see the
 * model types) with only the trip-date "avg." label, never the
 * picture's sample temperatures; the photo renders only when a real
 * fetched photo was supplied, with the same load guarantee as
 * DestinationPhotoBand (invisible until its load event lands; on
 * error the whole photo unmounts and the header falls back to its
 * bare form — never a broken image).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Clock, Cloud, Flag, MapPin, MessageCircle, Plug } from "lucide-react";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { COUNTRY_INFO_TABS } from "@/lib/roamly/countryInfoPanelTypes";
import type { CountryInfoPanelModel, CountryInfoTabId } from "@/lib/roamly/countryInfoPanelTypes";
import {
  TripWeatherCard,
  TripWeatherConditionIcon,
  type TripWeatherState
} from "@/components/roamly/TripWeatherCard";
import { getTripWeather } from "@/lib/roamly/tripWeather";

function isTabId(value: unknown): value is CountryInfoTabId {
  return (
    value === "overview" || value === "entry-travel" || value === "transport" || value === "safety"
  );
}

function CheckList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[16px] font-normal leading-[1.5] text-cink">
          <span
            aria-hidden
            className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cgreen text-[12px] font-bold text-white"
          >
            ✓
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// Picture 2 grid icons, one per cell. The Country cell's picture icon
// is the sample destination's own flag; no country→flag dataset exists
// in this codebase, so the cell carries a generic flag outline instead
// of a guessed flag (see the Picture 2 report, DIFFERENT note).
function GridIcon({ cellKey, countryValue }: { cellKey: string; countryValue?: string | null }) {
  // 24px box (not 28px): the grid text column at 390px is ~55px, and
  // the 28px icon + 13px value broke short words mid-word. The 22px
  // glyphs/svgs still fit inside 24px.
  const wrap = "flex h-6 w-6 shrink-0 items-center justify-center";
  if (cellKey === "country") {
    // Originals pass: the Country cell carries a real flag glyph when
    // the trip's country is one this mapping covers (Canada only —
    // the flag is a presentational glyph for a verified country value,
    // never a guessed asset). Any other country keeps the generic
    // outline; the glyph must never render for an unmatched value.
    if ((countryValue || "").trim().toLowerCase() === "canada") {
      return (
        <span aria-hidden className={`${wrap} text-[22px] leading-none`}>
          🇨🇦
        </span>
      );
    }
    return (
      <span aria-hidden className={`${wrap} text-cblue`}>
        <Flag size={22} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }
  if (cellKey === "city") {
    return (
      <span aria-hidden className={`${wrap} rounded-full bg-csoft text-cblue`}>
        <MapPin size={16} strokeWidth={2.2} aria-hidden="true" />
      </span>
    );
  }
  if (cellKey === "timezone") {
    return (
      <span aria-hidden className={`${wrap} text-cblue`}>
        <Clock size={22} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }
  if (cellKey === "currency") {
    return (
      <span aria-hidden className={`${wrap} rounded-full bg-cgreen text-[15px] font-bold text-white`}>
        $
      </span>
    );
  }
  if (cellKey === "language") {
    return (
      <span aria-hidden className={`${wrap} text-cblue`}>
        <MessageCircle size={22} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span aria-hidden className={`${wrap} text-cblue`}>
      <Plug size={22} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

export function CountryInfoPanel({
  model,
  initialTab
}: {
  model: CountryInfoPanelModel;
  initialTab?: string;
}) {
  const [activeTab, setActiveTab] = useState<CountryInfoTabId>(
    isTabId(initialTab) ? initialTab : "overview"
  );
  const [photoState, setPhotoState] = useState<"pending" | "loaded" | "failed">("pending");
  const imgRef = useRef<HTMLImageElement | null>(null);

  // The photo may finish (or fail) before hydration attaches the
  // handlers; settle from the element's own state on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      setPhotoState(img.naturalWidth > 0 ? "loaded" : "failed");
    }
  }, [model.photo?.imageUrl]);

  const showPhoto = model.photo && photoState !== "failed";

  // Weather (Fix Round Item 4, 2026-11-06): the model either carries
  // weather a caller already fetched ("data") or a request — the
  // trip's own coordinates + dates. The request resolves ONCE per
  // mount through the weather module's server action (the model
  // builder is synchronous, so the fetch cannot happen inside it).
  // A null request means the trip record holds no coordinates: the
  // model's honest message is the final state, no fetch is tried.
  // While a request is in flight, no weather block renders — a
  // placeholder never flashes.
  const weatherRequest = model.weather.request;
  const [liveWeather, setLiveWeather] = useState<TripWeatherState | null>(
    model.weather.status === "data" ? model.weather.data : null
  );
  const weatherFetchedRef = useRef(false);
  useEffect(() => {
    if (model.weather.status === "data" || !weatherRequest || weatherFetchedRef.current) {
      return;
    }
    weatherFetchedRef.current = true;
    let cancelled = false;
    getTripWeather(weatherRequest)
      .then((result) => {
        if (!cancelled) setLiveWeather(result);
      })
      .catch(() => {
        if (!cancelled) setLiveWeather({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [model.weather.status, weatherRequest]);

  // The photo overlay's weather lines, from the resolved state: the
  // headline temperature + condition when a forecast exists, the
  // honest window / load messages when it cannot, nothing for a
  // finished trip or while the request is in flight.
  const overlay: { icon: ReactNode; primary: string } | null = (() => {
    if (liveWeather) {
      if (liveWeather.kind === "ready") {
        return {
          icon: (
            <TripWeatherConditionIcon name={liveWeather.headline.icon} size={20} className="text-white" />
          ),
          primary: `${Math.round(liveWeather.headline.tMaxC)}° · ${liveWeather.headline.conditionLabel}`
        };
      }
      if (liveWeather.kind === "too-early") {
        return {
          icon: <Cloud size={20} strokeWidth={2} />,
          primary: "Forecast appears about two weeks before your trip"
        };
      }
      if (liveWeather.kind === "error") {
        return { icon: <Cloud size={20} strokeWidth={2} />, primary: "Weather couldn't load" };
      }
      return null;
    }
    if (model.weather.status === "unavailable" && !weatherRequest) {
      return { icon: <Cloud size={20} strokeWidth={2} />, primary: model.weather.message };
    }
    return null;
  })();

  return (
    <div>
      {/* Header, in the picture's order: back chevron left; eyebrow,
          destination, date line. No origin line — the picture has
          none. Jakob's Law A7 (2026-11-03): the bookmark and
          ellipsis icons the picture showed at top-right are REMOVED
          — no bookmark feature exists in this codebase, and in the
          reference apps those positions mean Save and More, so dead
          icons there are a familiarity defect, not decoration.
          A2: the back control now carries the 44px minimum target
          and a visible "Itinerary" label. */}
      <div className="flex items-center">
        <a
          href={model.itineraryHref}
          aria-label="Back to itinerary"
          className="flex min-h-11 min-w-11 items-center gap-0.5 text-chead"

        >
          <ChevronLeft size={32} strokeWidth={2} aria-hidden="true" />
          <span className="text-[15px] font-semibold leading-5">Itinerary</span>
        </a>
      </div>
      <p className="mt-2 text-[15px] font-semibold uppercase tracking-[0.06em] text-cgray">COUNTRY INFO</p>
      <h1 className="mt-1.5 text-[26px] font-bold leading-[1.15] tracking-[-0.018em] text-chead">
        {model.destinationLabel}
      </h1>
      {model.dateRange ? (
        <p className="mt-1.5 text-[15px] font-normal text-cgray">{model.dateRange}</p>
      ) : (
        <p className="mt-1.5 text-[15px] font-normal text-cgray">Dates to confirm</p>
      )}

      {/* Tabs: real tab state, one panel visible at a time. */}
      <div role="tablist" aria-label="Country information" className="mt-5 flex gap-1 overflow-x-auto rounded-full border border-chair bg-csoft p-1 shadow-bui-card">
        {COUNTRY_INFO_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-tab-id={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`bui-press bui-touch shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[14px] font-semibold sm:text-[15px] ${
                selected ? "bg-cnavy text-white shadow-bui-card" : "text-cgray hover:bg-white hover:text-chead"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" ? (
        <div role="tabpanel" data-panel-id="overview" className="bui-enter pt-5">
          {/* Photo hero + weather overlay card, in the picture's
              position (top-right of the photo). The overlay shows
              the trip's REAL weather headline (Fix Round Item 4,
              2026-11-06): the resolved forecast's temperature +
              condition, or the honest window / load messages — never
              sample temperatures. No photo → no figure and no
              overlay; the full forecast card below stands alone. */}
          {showPhoto ? (
            <figure className="relative mb-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={model.photo!.imageUrl}
                alt={model.destinationLabel}
                loading="lazy"
                onLoad={() => setPhotoState("loaded")}
                onError={() => setPhotoState("failed")}
                className={`h-[188px] w-full rounded-bui-panel border border-chair object-cover shadow-bui-card transition-opacity duration-300 ${
                  photoState === "loaded" ? "opacity-100" : "opacity-0"
                }`}
              />
              {/* Weather display rules at card scale (owner set,
                  2026-11-04): the text block shares ONE left edge;
                  gaps come from three sizes only (4/8/12); one plain
                  text style, nothing shouting; base text (white) +
                  ONE accent; the secondary line stays at white/90 on
                  a deepened scrim for readable contrast; the
                  condition glyph is a stroke icon at one fixed size
                  (20px), a Lucide icon. Since Fix Round Item 4 the
                  overlay carries the real headline (temperature +
                  condition) from lib/roamly/tripWeather.ts; the
                  huge-temperature, grouping and range-bar rules live
                  in the full TripWeatherCard below the photo. */}
              {overlay ? (
                <span
                  data-weather-overlay
                  className="absolute right-3 top-3 flex max-w-[62%] gap-2 rounded-bui-card bg-cnavy/80 px-3 py-2.5 text-white"
                >
                  <span aria-hidden className="mt-0.5 shrink-0">
                    {overlay.icon}
                  </span>

                  <span>
                    <span className="block text-[14px] font-semibold leading-5">{overlay.primary}</span>
                    {model.weather.avgLabel ? (
                      <span className="mt-1 block text-[13px] font-normal leading-5 text-white/90">
                        {model.weather.avgLabel}
                      </span>
                    ) : null}
                  </span>
                </span>
              ) : null}
              {photoState === "loaded" && model.photo!.credit ? (
                <figcaption className="mt-1.5 text-right text-[11px] leading-4 text-cgray2">
                  Photo:{" "}
                  {model.photo!.pageUrl ? (
                    <a
                      href={model.photo!.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-chair underline-offset-2"
                    >
                      {model.photo!.credit}
                    </a>
                  ) : (
                    model.photo!.credit
                  )}
                </figcaption>
              ) : null}
            </figure>
          ) : null}

          {/* Trip weather card (Fix Round Item 4): the trip's full
              forecast — the same resolved state as the photo
              overlay, rendered by the one shared component. A
              finished trip renders nothing; with no photo the card
              stands alone in the same slot. */}
          {liveWeather && liveWeather.kind !== "past" ? (
            <TripWeatherCard weather={liveWeather} className="mb-5" />
          ) : null}

          {/* Key information grid, in the picture's order, with the
              picture's icon + label + value-lines cell shape. */}
          <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">Key information</h2>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {model.grid.map((cell) => (
              <BuiCard key={cell.key} className="flex min-w-0 gap-2 bg-cbg px-2 py-3">
                <GridIcon cellKey={cell.key} countryValue={cell.key === "country" ? (cell.valueLines?.join(" ") ?? cell.value ?? null) : null} />
                <div className="min-w-0">
                  <dt className="text-[12px] font-normal leading-4 text-cgray">{cell.label}</dt>
                  {cell.valueLines ? (
                    <dd className="mt-0.5 leading-snug">
                      {/* 12px (not 13px) + px-2 cells: at 390px the text
                          column is ~55px, and 13px semibold broke
                          "Canada"/"Montreal"/"Eastern" mid-word in
                          headless captures (pre-existing, not a data
                          issue). break-words stays as the safety net
                          for a genuinely unbroken long token. */}
                      <span className="block break-words text-[12px] font-semibold text-chead">{cell.valueLines[0]}</span>
                      {cell.valueLines.slice(1).map((line) => (
                        <span key={line} className="block break-words text-[12px] font-normal text-cink">
                          {line}
                        </span>
                      ))}
                    </dd>
                  ) : (
                    <dd className="mt-0.5 break-words text-[12px] font-normal leading-snug text-cgray">{cell.unavailable}</dd>
                  )}
                </div>
              </BuiCard>
            ))}
          </dl>

          {/* Travel notes for this trip: checklist inside the picture's
              single light card. No summary paragraph — the picture
              ends the notes at the last bullet. */}
          <div className="mt-6 border-t border-chair pt-5">
            <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">
              {model.notesTitle}
            </h2>
            <div className="mt-3 rounded-2xl bg-cbg px-4 py-4">
              <CheckList items={model.notes} />
            </div>
          </div>

          {/* Batch 7: the panel's closing CTA rides BuiButtonLink;
              the picture's right-edge chevron is kept as an absolute
              child slot inside the button (the ux-picture2 suite pins
              the picture shape: full width, chevron at the edge). */}
          <BuiButtonLink
            href={model.itineraryHref}
            className="relative mt-6 min-h-12 w-full rounded-bui-card px-5 text-[16.5px]"
          >
            See full itinerary
            <span aria-hidden className="absolute right-4 flex items-center">
              <ChevronRight size={20} strokeWidth={2} />
            </span>
          </BuiButtonLink>
        </div>
      ) : null}

      {activeTab === "entry-travel" ? (
        <div role="tabpanel" data-panel-id="entry-travel" className="bui-enter pt-5">
          <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">Entry &amp; Travel</h2>
          <p className="mt-3 text-[16px] font-normal leading-[1.5] text-cink">
            {model.entryTravel.routeLine}
          </p>
          <div className="mt-3">
            <CheckList items={model.entryTravel.lines} />
          </div>
          <p className="mt-3 text-[15px] font-normal leading-[1.5] text-cgray">
            {model.entryTravel.requirementsUnavailable}
          </p>
          <p className="mt-3 text-[15px] font-normal leading-[1.5] text-cgray">
            {model.routeSummary}
          </p>
        </div>
      ) : null}

      {activeTab === "transport" ? (
        <div role="tabpanel" data-panel-id="transport" className="bui-enter pt-5">
          <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">Transport</h2>
          {model.transport.preference ? (
            <p className="mt-3 text-[16px] font-normal leading-[1.5] text-cink">
              Transportation preference: {model.transport.preference}
            </p>
          ) : (
            <p className="mt-3 text-[16px] font-normal leading-[1.5] text-cink">
              {model.transport.preferenceUnavailable}
            </p>
          )}
          <div className="mt-3">
            <CheckList items={[model.transport.scheduleLine]} />
          </div>
          <p className="mt-3 text-[15px] font-normal leading-[1.5] text-cgray">
            {model.transport.schedulesUnavailable}
          </p>
        </div>
      ) : null}

      {activeTab === "safety" ? (
        <div role="tabpanel" data-panel-id="safety" className="bui-enter pt-5">
          <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">Safety</h2>
          <div className="mt-3">
            <CheckList items={model.safety.lines} />
          </div>
          <p className="mt-3 text-[15px] font-normal leading-[1.5] text-cgray">
            {model.safety.advisoryUnavailable}
          </p>
        </div>
      ) : null}
    </div>
  );
}
