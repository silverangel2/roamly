"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  localPlaceSearch,
  normalizeCustomPlace,
  normalizePlaceText,
  recommendedPlaces,
  type NormalizedPlace
} from "@/lib/roamly/places";
import { useI18n } from "@/components/i18n/I18nProvider";

type PlaceSelectorProps = {
  label: string;
  value: NormalizedPlace | null;
  onChange: (place: NormalizedPlace | null) => void;
  placeholder?: string;
  helper?: string;
  popularPlaces?: NormalizedPlace[];
  enableAutocomplete?: boolean;
};

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function samePlace(a: NormalizedPlace | null, b: NormalizedPlace | null) {
  if (!a || !b) return false;
  return (a.place_id && a.place_id === b.place_id) || normalizePlaceText(a.value) === normalizePlaceText(b.value);
}

function mergePlaces(primary: NormalizedPlace[], fallback: NormalizedPlace[]) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((place) => {
    const key = `${place.place_id || ""}:${place.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function PlaceSelector({
  label,
  value,
  onChange,
  placeholder = "Search anywhere",
  helper,
  popularPlaces = recommendedPlaces.slice(0, 6),
  enableAutocomplete = true
}: PlaceSelectorProps) {
  const { translateText } = useI18n();
  const [query, setQuery] = useState(value?.label || "");
  const [results, setResults] = useState<NormalizedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value?.label || "");
  }, [value?.label]);

  useEffect(() => {
    const cleaned = normalizePlaceText(query);
    if (!open || !enableAutocomplete || cleaned.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/roamly/places/autocomplete?query=${encodeURIComponent(cleaned)}`, {
          signal: controller.signal
        });
        const data = (await response.json().catch(() => null)) as { results?: NormalizedPlace[] } | null;
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        if (!controller.signal.aborted) setResults(localPlaceSearch(cleaned));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enableAutocomplete, open, query]);

  const cleanedQuery = normalizePlaceText(query);
  const visiblePlaces = useMemo(() => {
    const localMatches = cleanedQuery.length >= 2 ? localPlaceSearch(cleanedQuery, popularPlaces) : popularPlaces;
    return mergePlaces(results, localMatches).slice(0, 8);
  }, [cleanedQuery, popularPlaces, results]);
  const exactMatch = visiblePlaces.some((place) => normalizePlaceText(place.value).toLowerCase() === cleanedQuery.toLowerCase());
  const showCustom = cleanedQuery.length >= 2 && !exactMatch;

  function updateTypedValue(nextValue: string) {
    setQuery(nextValue);
    const cleaned = normalizePlaceText(nextValue);
    onChange(cleaned ? normalizeCustomPlace(cleaned) : null);
  }

  function selectPlace(place: NormalizedPlace) {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setQuery(place.label);
    onChange(place);
    setOpen(false);
  }

  return (
    <div className="relative">
      <label className="block">
        <span className="text-sm font-black text-ink">{translateText(label)}</span>
        {helper ? <span className="mt-1 block text-sm font-bold leading-6 text-slate-500">{translateText(helper)}</span> : null}
        <input
          value={query}
          onChange={(event) => updateTypedValue(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 140);
          }}
          autoComplete="off"
          aria-label={translateText(label)}
          placeholder={translateText(placeholder)}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
        />
      </label>

      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-[1.25rem] border border-cloud bg-white shadow-soft">
          <div className="max-h-80 overflow-auto p-2">
            {loading ? (
              <div className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
                {translateText("Searching places...")}
              </div>
            ) : null}

            {visiblePlaces.map((place) => (
              <button
                key={`${place.source}-${place.place_id || place.value}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectPlace(place);
                }}
                className={classNames(
                  "w-full rounded-2xl px-4 py-3 text-left transition",
                  samePlace(value, place)
                    ? "bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/20"
                    : "hover:bg-cyan-50 hover:text-cyan-700"
                )}
              >
                <span className="block text-sm font-black">{place.label}</span>
                <span className={classNames("mt-1 block text-xs font-bold", samePlace(value, place) ? "text-white/85" : "text-slate-500")}>
                  {[place.city, place.region, place.country].filter(Boolean).join(", ") || translateText("Suggested place")}
                </span>
              </button>
            ))}

            {showCustom ? (
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectPlace(normalizeCustomPlace(cleanedQuery));
                }}
                className="w-full rounded-2xl px-4 py-3 text-left transition hover:bg-mist"
              >
                <span className="block text-sm font-black">{cleanedQuery}</span>
                <span className="mt-1 block text-xs font-bold text-slate-500">{translateText("Use custom place")}</span>
              </button>
            ) : null}

            {!loading && !visiblePlaces.length && !showCustom ? (
              <div className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
                {translateText("Start typing a city, region, or country.")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
