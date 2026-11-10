"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BuiButton } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import { localizeCustomerError } from "@/lib/i18n";
import type { TripFeedbackRecord } from "@/lib/roamly/tripFeedback";

type FeedbackMode = "post_trip" | "in_trip";

function csv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/*
 * Batch 7 (2026-11-09): the feedback fields ride the BoardUI form
 * pattern (batches 3/4/6 wiring) — a real visible label that never
 * leaves and the foundation `bui-input` recipe. This form has no
 * field-level validators (every field is optional; the save is the
 * only gate), so there are no useBuiField hooks here: the pattern's
 * label + input half applies, and the save outcome renders through
 * BuiNotice below. "Trip day" keeps type="number": it is a quantity
 * (a day count), not a code — the same house exception the plan
 * form's budget carries; inputMode="numeric" is added.
 */
const feedbackInputClass =
  "bui-input mt-2 w-full rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10";

function FeedbackField({
  id,
  label,
  value,
  onChange,
  type = "text",
  inputMode,
  min
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "numeric" | "decimal" | "text";
  min?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-chead">{label}</span>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={feedbackInputClass}
      />
    </label>
  );
}

function FeedbackSelectField({
  id,
  label,
  value,
  onChange,
  children
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-chead">{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={feedbackInputClass}>
        {children}
      </select>
    </label>
  );
}

function ScoreSelect({
  id,
  label,
  value,
  onChange
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <FeedbackSelectField
      id={id}
      label={label}
      value={String(value ?? "")}
      onChange={(next) => onChange(next ? Number(next) : null)}
    >
      <option value="">Not rated</option>
      {[1, 2, 3, 4, 5].map((score) => (
        <option key={score} value={score}>
          {score}
        </option>
      ))}
    </FeedbackSelectField>
  );
}

export function TripFeedbackForm({ tripId, initialFeedback = [] }: { tripId: string; initialFeedback?: TripFeedbackRecord[] }) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<FeedbackMode>("post_trip");
  const [overallSatisfaction, setOverallSatisfaction] = useState<number | null>(null);
  const [transportationSatisfaction, setTransportationSatisfaction] = useState<number | null>(null);
  const [hotelLocationSatisfaction, setHotelLocationSatisfaction] = useState<number | null>(null);
  const [hotelQualitySatisfaction, setHotelQualitySatisfaction] = useState<number | null>(null);
  const [budgetAccuracy, setBudgetAccuracy] = useState<number | null>(null);
  const [scheduleRealism, setScheduleRealism] = useState<number | null>(null);
  const [recommendationUsefulness, setRecommendationUsefulness] = useState<number | null>(null);
  const [pace, setPace] = useState("right");
  const [tripDay, setTripDay] = useState("");
  const [favourites, setFavourites] = useState("");
  const [disappointments, setDisappointments] = useState("");
  const [skipped, setSkipped] = useState("");
  const [freeText, setFreeText] = useState("");
  const [wouldUseAgain, setWouldUseAgain] = useState<boolean | null>(null);
  const [transportDifficult, setTransportDifficult] = useState(false);
  const [adjustTomorrow, setAdjustTomorrow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [learned, setLearned] = useState<Array<{ preference_key: string; proposed_value: unknown; reason: string }>>([]);
  const [error, setError] = useState("");

  const restoreFeedback = useCallback((feedbackType: FeedbackMode) => {
    const saved = initialFeedback
      .filter((entry) => entry.feedback_type === feedbackType)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    setTripDay(saved?.trip_day ? String(saved.trip_day) : "");
    setOverallSatisfaction(saved?.overall_satisfaction ?? null);
    setTransportationSatisfaction(saved?.transportation_satisfaction ?? null);
    setHotelLocationSatisfaction(saved?.hotel_location_satisfaction ?? null);
    setHotelQualitySatisfaction(saved?.hotel_quality_satisfaction ?? null);
    setBudgetAccuracy(saved?.budget_accuracy ?? null);
    setScheduleRealism(saved?.schedule_realism ?? null);
    setRecommendationUsefulness(saved?.recommendation_usefulness ?? null);
    setPace(feedbackType === "in_trip" ? saved?.today_pace || "right" : saved?.itinerary_pace || "right");
    setFavourites(saved?.favourite_activities.join(", ") || "");
    setDisappointments(saved?.disappointing_activities.join(", ") || "");
    setSkipped(saved?.skipped_activities.join(", ") || "");
    setFreeText(saved?.free_text_feedback || "");
    setWouldUseAgain(saved?.would_use_roamly_again ?? null);
    setTransportDifficult(saved?.transportation_difficult ?? false);
    setAdjustTomorrow(saved?.adjust_tomorrow ?? false);
    setLearned(saved?.learned_preferences_json || []);
    setMessage("");
    setError("");
  }, [initialFeedback]);

  useEffect(() => {
    restoreFeedback("post_trip");
  }, [restoreFeedback]);

  async function submit() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          feedbackType: mode,
          tripDay: mode === "in_trip" && tripDay ? Number(tripDay) : null,
          overallSatisfaction,
          itineraryPace: mode === "post_trip" ? pace : null,
          todayPace: mode === "in_trip" ? pace : null,
          transportationSatisfaction,
          hotelLocationSatisfaction,
          hotelQualitySatisfaction,
          budgetAccuracy,
          scheduleRealism,
          recommendationUsefulness,
          favouriteActivities: csv(favourites),
          disappointingActivities: csv(disappointments),
          skippedActivities: csv(skipped),
          wouldUseRoamlyAgain: wouldUseAgain,
          freeTextFeedback: freeText,
          transportationDifficult: transportDifficult,
          adjustTomorrow
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        setError(localizeCustomerError(locale, data.error, "ui.status.feedbackSaveFailed"));
        return;
      }
      setMessage(data.message ? localizeCustomerError(locale, data.message, "ui.status.feedbackSaved") : t("ui.status.feedbackSaved"));
      setLearned(Array.isArray(data.proposedPreferences) ? data.proposedPreferences : []);
    } catch (saveError) {
      setError(localizeCustomerError(locale, saveError, "ui.status.feedbackSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BuiCard className="p-5">
      <div className="flex flex-wrap gap-2">
        {(["post_trip", "in_trip"] as const).map((nextMode) => (
          <button
            key={nextMode}
            type="button"
            aria-pressed={mode === nextMode}
            onClick={() => {
              setMode(nextMode);
              restoreFeedback(nextMode);
            }}
            className={`bui-press bui-touch inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors duration-200 ease-bui focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 ${
              mode === nextMode ? "bg-cblue text-white" : "bg-csoft text-cink hover:text-chead"
            }`}
          >
            {nextMode === "post_trip" ? "Trip feedback" : "Today"}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {mode === "in_trip" ? (
          <FeedbackField id="feedback-trip-day" label="Trip day" type="number" inputMode="numeric" min={1} value={tripDay} onChange={setTripDay} />
        ) : null}
        <FeedbackSelectField id="feedback-pace" label="Pace" value={pace} onChange={setPace}>
          <option value="too_busy">Too busy</option>
          <option value="right">Right</option>
          <option value="too_slow">Too slow</option>
        </FeedbackSelectField>
        <ScoreSelect id="feedback-score-overall" label="Overall satisfaction" value={overallSatisfaction} onChange={setOverallSatisfaction} />
        <ScoreSelect id="feedback-score-transportation" label="Transportation" value={transportationSatisfaction} onChange={setTransportationSatisfaction} />
        <ScoreSelect id="feedback-score-hotel-location" label="Hotel location" value={hotelLocationSatisfaction} onChange={setHotelLocationSatisfaction} />
        <ScoreSelect id="feedback-score-hotel-quality" label="Hotel quality" value={hotelQualitySatisfaction} onChange={setHotelQualitySatisfaction} />
        <ScoreSelect id="feedback-score-budget" label="Budget accuracy" value={budgetAccuracy} onChange={setBudgetAccuracy} />
        <ScoreSelect id="feedback-score-schedule" label="Schedule realism" value={scheduleRealism} onChange={setScheduleRealism} />
        <ScoreSelect id="feedback-score-recommendations" label="Recommendation usefulness" value={recommendationUsefulness} onChange={setRecommendationUsefulness} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <FeedbackField id="feedback-favourites" label="Favourite activities" value={favourites} onChange={setFavourites} />
        <FeedbackField id="feedback-disappointments" label="Disappointing activities" value={disappointments} onChange={setDisappointments} />
        <FeedbackField id="feedback-skipped" label="Skipped activities" value={skipped} onChange={setSkipped} />
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="text-sm font-black text-chead">Notes</span>
          <textarea
            id="feedback-notes"
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            rows={4}
            className={feedbackInputClass}
          />
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-chead">
          <input type="checkbox" checked={transportDifficult} onChange={(event) => setTransportDifficult(event.target.checked)} className="h-5 w-5 shrink-0 accent-cblue" />
          Transportation was difficult
        </label>
        {mode === "in_trip" ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-chead">
            <input type="checkbox" checked={adjustTomorrow} onChange={(event) => setAdjustTomorrow(event.target.checked)} className="h-5 w-5 shrink-0 accent-cblue" />
            Adjust tomorrow
          </label>
        ) : (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-chead">
            <input
              type="checkbox"
              checked={wouldUseAgain === true}
              onChange={(event) => setWouldUseAgain(event.target.checked ? true : null)}
              className="h-5 w-5 shrink-0 accent-cblue"
            />
            Would use Roamly again
          </label>
        )}
      </div>

      <BuiButton type="button" onClick={submit} disabled={saving} busy={saving} className="mt-5">
        {saving ? "Saving..." : "Save feedback"}
      </BuiButton>

      {error ? <BuiNotice tone="error" title={error} className="mt-3" /> : null}
      {message ? <BuiNotice tone="success" title={message} className="mt-3" /> : null}
      {learned.length ? (
        <div className="mt-4 rounded-bui-card bg-cbg px-4 py-4">
          <p className="text-sm font-black text-chead">Here is what Roamly learned from your trip.</p>
          <ul className="mt-2 grid gap-2 text-sm font-bold text-cink">
            {learned.map((item, index) => (
              <li key={`${item.preference_key}-${index}`}>
                {item.preference_key}: {typeof item.proposed_value === "string" ? item.proposed_value : JSON.stringify(item.proposed_value)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </BuiCard>
  );
}
