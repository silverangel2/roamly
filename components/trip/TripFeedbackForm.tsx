"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

type FeedbackMode = "post_trip" | "in_trip";

function csv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ScoreSelect({
  label,
  value,
  onChange
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-slate-700">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm"
      >
        <option value="">Not rated</option>
        {[1, 2, 3, 4, 5].map((score) => (
          <option key={score} value={score}>
            {score}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TripFeedbackForm({ tripId }: { tripId: string }) {
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
        setError(data.error || "Feedback could not be saved.");
        return;
      }
      setMessage(data.message || "Feedback saved.");
      setLearned(Array.isArray(data.proposedPreferences) ? data.proposedPreferences : []);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Feedback could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="flex flex-wrap gap-2">
        {(["post_trip", "in_trip"] as const).map((nextMode) => (
          <button
            key={nextMode}
            type="button"
            onClick={() => setMode(nextMode)}
            className={`rounded-full px-4 py-2 text-sm font-black ${
              mode === nextMode ? "bg-ink text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {nextMode === "post_trip" ? "Trip feedback" : "Today"}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {mode === "in_trip" ? (
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            <span>Trip day</span>
            <input
              type="number"
              min={1}
              value={tripDay}
              onChange={(event) => setTripDay(event.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-ink shadow-sm"
            />
          </label>
        ) : null}
        <label className="grid gap-2 text-sm font-bold text-slate-700">
          <span>Pace</span>
          <select
            value={pace}
            onChange={(event) => setPace(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm"
          >
            <option value="too_busy">Too busy</option>
            <option value="right">Right</option>
            <option value="too_slow">Too slow</option>
          </select>
        </label>
        <ScoreSelect label="Overall satisfaction" value={overallSatisfaction} onChange={setOverallSatisfaction} />
        <ScoreSelect label="Transportation" value={transportationSatisfaction} onChange={setTransportationSatisfaction} />
        <ScoreSelect label="Hotel location" value={hotelLocationSatisfaction} onChange={setHotelLocationSatisfaction} />
        <ScoreSelect label="Hotel quality" value={hotelQualitySatisfaction} onChange={setHotelQualitySatisfaction} />
        <ScoreSelect label="Budget accuracy" value={budgetAccuracy} onChange={setBudgetAccuracy} />
        <ScoreSelect label="Schedule realism" value={scheduleRealism} onChange={setScheduleRealism} />
        <ScoreSelect label="Recommendation usefulness" value={recommendationUsefulness} onChange={setRecommendationUsefulness} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="grid gap-2 text-sm font-bold text-slate-700">
          <span>Favourite activities</span>
          <input value={favourites} onChange={(event) => setFavourites(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-ink shadow-sm" />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-700">
          <span>Disappointing activities</span>
          <input value={disappointments} onChange={(event) => setDisappointments(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-ink shadow-sm" />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-700">
          <span>Skipped activities</span>
          <input value={skipped} onChange={(event) => setSkipped(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-ink shadow-sm" />
        </label>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-2 text-sm font-bold text-slate-700">
          <span>Notes</span>
          <textarea
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            rows={4}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-ink shadow-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <input type="checkbox" checked={transportDifficult} onChange={(event) => setTransportDifficult(event.target.checked)} />
          Transportation was difficult
        </label>
        {mode === "in_trip" ? (
          <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={adjustTomorrow} onChange={(event) => setAdjustTomorrow(event.target.checked)} />
            Adjust tomorrow
          </label>
        ) : (
          <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={wouldUseAgain === true}
              onChange={(event) => setWouldUseAgain(event.target.checked ? true : null)}
            />
            Would use Roamly again
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="mt-5 rounded-full bg-ocean px-5 py-3 text-sm font-black text-white shadow-soft disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save feedback"}
      </button>

      {error ? <p className="mt-3 text-sm font-black text-red-600">{error}</p> : null}
      {message ? <p className="mt-3 text-sm font-black text-ink">{message}</p> : null}
      {learned.length ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-black text-ink">Here is what Roamly learned from your trip.</p>
          <ul className="mt-2 grid gap-2 text-sm font-bold text-slate-600">
            {learned.map((item, index) => (
              <li key={`${item.preference_key}-${index}`}>
                {item.preference_key}: {typeof item.proposed_value === "string" ? item.proposed_value : JSON.stringify(item.proposed_value)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
