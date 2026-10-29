"use client";

/*
 * CountryInfoPanel — the Country Info page, Picture 2 overhaul
 * (2026-10-26) against screenshots-latest/correct-4-pages.jpg,
 * TOP-RIGHT panel, followed literally, top to bottom:
 * header (back chevron, "COUNTRY INFO" eyebrow, destination, date
 * line, bookmark + ellipsis icons) → tabs Overview / Entry & Travel
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

import { useEffect, useRef, useState } from "react";
import { COUNTRY_INFO_TABS } from "@/lib/roamly/countryInfoPanelTypes";
import type { CountryInfoPanelModel, CountryInfoTabId } from "@/lib/roamly/countryInfoPanelTypes";

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
            className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a9e4b] text-[12px] font-bold text-white"
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
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 21V4" />
          <path d="M5 4h13l-2.5 4L18 12H5" />
        </svg>
      </span>
    );
  }
  if (cellKey === "city") {
    return (
      <span aria-hidden className={`${wrap} rounded-full bg-csoft text-cblue`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </span>
    );
  }
  if (cellKey === "timezone") {
    return (
      <span aria-hidden className={`${wrap} text-cblue`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
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
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-8 8H4l2-3.5A8 8 0 1 1 21 12Z" />
          <path d="M8 12h8" />
        </svg>
      </span>
    );
  }
  return (
    <span aria-hidden className={`${wrap} text-cblue`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 2v5H7v3h10V7h-2V2h-2v5h-2V2H9Z" />
        <path d="M12 10v4" stroke="currentColor" strokeWidth="2" />
        <path d="M8 14h8v3a4 4 0 0 1-8 0v-3Z" />
      </svg>
    </span>
  );
}

function BookmarkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-cnavy">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z" />
    </svg>
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

  return (
    <div>
      {/* Header, in the picture's order: back chevron left, bookmark +
          ellipsis right; eyebrow, destination, date line. No origin
          line — the picture has none. The bookmark / ellipsis icons
          are present visually as in the picture; no bookmark feature
          exists in this codebase, so they carry no action. */}
      <div className="flex items-center justify-between">
        <a
          href={model.itineraryHref}
          aria-label="Back to itinerary"
          className="text-[32px] font-normal leading-none text-chead"
        >
          ‹
        </a>
        <div className="flex items-center gap-4" aria-hidden>
          <BookmarkIcon />
          <span className="text-[22px] font-bold leading-none tracking-[0.18em] text-chead">•••</span>
        </div>
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
      <div role="tablist" aria-label="Country information" className="mt-5 flex gap-3 border-b border-chair sm:gap-5">
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
              className={`-mb-px whitespace-nowrap border-b-2 pb-2 text-[14px] font-semibold sm:text-[15px] ${
                selected ? "border-cblue text-cblue" : "border-transparent text-cgray"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" ? (
        <div role="tabpanel" data-panel-id="overview" className="pt-5">
          {/* Photo hero + weather overlay card, in the picture's
              position (top-right of the photo). The card keeps the
              picture's shape — cloud icon + date "avg." label — but
              its weather lines are the honest unavailable state, never
              the picture's sample temperatures. No photo → bare
              header: no photo figure and no standalone weather block. */}
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
                className={`h-[188px] w-full rounded-[18px] object-cover transition-opacity duration-300 ${
                  photoState === "loaded" ? "opacity-100" : "opacity-0"
                }`}
              />
              <span
                data-weather-overlay
                className="absolute right-3 top-3 flex max-w-[62%] gap-2.5 rounded-xl bg-black/55 px-3 py-2.5 text-white"
              >
                <span aria-hidden className="mt-0.5 shrink-0 text-[20px] leading-none">
                  ☁
                </span>
                <span>
                  <span className="block text-[14px] font-semibold leading-5">{model.weather.message}</span>
                  {model.weather.avgLabel ? (
                    <span className="mt-0.5 block text-[13px] font-normal leading-5 text-white/90">
                      {model.weather.avgLabel}
                    </span>
                  ) : null}
                </span>
              </span>
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

          {/* Key information grid, in the picture's order, with the
              picture's icon + label + value-lines cell shape. */}
          <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">Key information</h2>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {model.grid.map((cell) => (
              <div key={cell.key} className="flex min-w-0 gap-2 rounded-2xl bg-cbg px-2 py-3">
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
              </div>
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

          <a
            href={model.itineraryHref}
            className="relative mt-6 flex min-h-12 items-center justify-center rounded-xl bg-cblue px-5 text-[16.5px] font-semibold text-white"
          >
            See full itinerary
            <span aria-hidden className="absolute right-4 text-xl leading-none">
              ›
            </span>
          </a>
        </div>
      ) : null}

      {activeTab === "entry-travel" ? (
        <div role="tabpanel" data-panel-id="entry-travel" className="pt-5">
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
        <div role="tabpanel" data-panel-id="transport" className="pt-5">
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
        <div role="tabpanel" data-panel-id="safety" className="pt-5">
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
