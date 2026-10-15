"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import type {
  BookedSegmentOption,
  CompletedTripOption,
  ItinerarySubmissionRecord
} from "@/lib/roamly/itineraryLibrary";

type VerdictRow = {
  key: number;
  optionValue: string;
  rating: number | null;
  verdict: "" | "loved" | "fine" | "avoid";
  note: string;
};

type Props = {
  trips: CompletedTripOption[];
  selectedTripId: string | null;
  bookedSegments: BookedSegmentOption[];
  segmentsError: string | null;
  existingSubmission: ItinerarySubmissionRecord | null;
};

function optionValueFor(option: BookedSegmentOption) {
  return `${option.segmentId || ""}::${option.bookingId}`;
}

function findOption(options: BookedSegmentOption[], value: string) {
  return options.find((option) => optionValueFor(option) === value) || null;
}

function tripLabel(trip: CompletedTripOption) {
  const destination = trip.destinationCity || trip.destination || "Trip";
  const dates = [trip.startDate, trip.endDate].filter(Boolean).join(" → ");
  return `${trip.title || destination}${dates ? ` · ${dates}` : ""}`;
}

let rowKey = 1;

export function ItineraryShareForm({ trips, selectedTripId, bookedSegments, segmentsError, existingSubmission }: Props) {
  const router = useRouter();
  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) || null,
    [trips, selectedTripId]
  );

  const [destination, setDestination] = useState(selectedTrip?.destinationCity || selectedTrip?.destination || "");
  const [startDate, setStartDate] = useState(selectedTrip?.startDate || "");
  const [endDate, setEndDate] = useState(selectedTrip?.endDate || "");
  const [title, setTitle] = useState(selectedTrip?.title || "");
  const [highlights, setHighlights] = useState("");
  const [rows, setRows] = useState<VerdictRow[]>([{ key: rowKey++, optionValue: "", rating: null, verdict: "", note: "" }]);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ratedRows = rows.filter((row) => row.optionValue);

  function addRow() {
    if (rows.length >= 30) return;
    setRows((current) => [...current, { key: rowKey++, optionValue: "", rating: null, verdict: "", note: "" }]);
  }

  function updateRow(key: number, patch: Partial<VerdictRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: number) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!selectedTripId) {
      setError("Choose the completed trip you want to share.");
      return;
    }
    if (!destination.trim()) {
      setError("Destination is required.");
      return;
    }
    if (!ratedRows.length) {
      setError("Rate at least one booked item from your trip.");
      return;
    }
    for (const row of ratedRows) {
      if (row.rating == null && !row.verdict) {
        setError("Each rated item needs a star rating or a verdict.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const response = await fetchWithSupabaseAuth("/api/itinerary-submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId: selectedTripId,
          title: title.trim() || null,
          destination: destination.trim(),
          startDate: startDate || null,
          endDate: endDate || null,
          highlights: highlights.trim() || null,
          consentAnonymizedReuse: consent,
          itemVerdicts: ratedRows.map((row) => {
            const option = findOption(bookedSegments, row.optionValue);
            return {
              segmentId: option?.segmentId || null,
              bookingId: option?.bookingId || null,
              itemType: option?.itemType || "other",
              itemLabel: option?.itemLabel || "Booked item",
              location: option?.location || null,
              rating: row.rating,
              verdict: row.verdict || null,
              note: row.note.trim() || null
            };
          })
        })
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(body.error === "ALREADY_SUBMITTED"
          ? "This trip was already shared. One submission per completed trip."
          : body.error === "ITINERARY_LIBRARY_TABLES_NOT_READY"
            ? "The library tables are not ready yet — please try again later."
            : `Could not save your submission${body.error ? `: ${body.error}` : "."}`);
        return;
      }
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-3xl border border-ocean/20 bg-white/80 px-6 py-10 text-center shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Shared</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-ink">Thanks — your proven itinerary is in the library.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-slate-600">
          {consent
            ? "You consented to anonymized reuse, so future travelers heading the same way may benefit from what you learned."
            : "You did not consent to anonymized reuse, so this stays as your personal record only."}
        </p>
        <a href={selectedTripId ? `/trip/${selectedTripId}` : "/dashboard"} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ocean px-5 text-sm font-bold text-white">
          Back to your trip
        </a>
      </div>
    );
  }

  if (existingSubmission) {
    return (
      <div className="rounded-3xl border border-ocean/20 bg-white/80 px-6 py-10 text-center shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Already shared</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-ink">This trip is already in the library.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-slate-600">
          One submission per completed trip keeps the library honest. Shared{" "}
          {existingSubmission.created_at ? new Date(existingSubmission.created_at).toLocaleDateString() : "earlier"}.
        </p>
        <a href={`/trip/${existingSubmission.trip_id}`} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ocean px-5 text-sm font-bold text-white">
          View your trip
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <section className="rounded-3xl border border-[#e8dfd0] bg-white/80 px-5 py-6 shadow-[0_12px_34px_rgba(16,32,51,0.05)] sm:px-7">
        <h2 className="text-lg font-black text-ink">Which trip?</h2>
        {trips.length === 0 ? (
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            You have no completed trips yet. Once a trip is marked completed, it will appear here.
          </p>
        ) : (
          <label className="mt-3 grid gap-2 text-sm font-bold text-slate-700">
            <span>Completed trip</span>
            <select
              value={selectedTripId || ""}
              onChange={(event) => router.push(event.target.value ? `/trips/share?trip=${event.target.value}` : "/trips/share")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-ink shadow-sm"
            >
              <option value="">Choose a completed trip…</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>{tripLabel(trip)}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      {selectedTripId ? (
        <>
          <section className="rounded-3xl border border-[#e8dfd0] bg-white/80 px-5 py-6 shadow-[0_12px_34px_rgba(16,32,51,0.05)] sm:px-7">
            <h2 className="text-lg font-black text-ink">The trip</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                <span>Trip title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="e.g. Slow week in Lisbon" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                <span>Destination *</span>
                <input value={destination} onChange={(event) => setDestination(event.target.value)} maxLength={200} required className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                <span>Start date</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                <span>End date</span>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm" />
              </label>
            </div>
            <label className="mt-4 grid gap-2 text-sm font-bold text-slate-700">
              <span>What made this trip eventful / fruitful?</span>
              <textarea value={highlights} onChange={(event) => setHighlights(event.target.value)} maxLength={4000} rows={4} placeholder="The moments, places, or decisions future travelers should know about…" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold leading-6 text-ink shadow-sm" />
            </label>
          </section>

          <section className="rounded-3xl border border-[#e8dfd0] bg-white/80 px-5 py-6 shadow-[0_12px_34px_rgba(16,32,51,0.05)] sm:px-7">
            <h2 className="text-lg font-black text-ink">Rate what you booked</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
              Only items from your own booking wallet appear here — every rating is booking-proof.
            </p>
            {segmentsError ? (
              <p className="mt-3 rounded-2xl border border-coral/30 bg-coral/10 px-4 py-3 text-sm font-bold text-coral">
                Could not load your bookings: {segmentsError}
              </p>
            ) : bookedSegments.length === 0 ? (
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                No bookings found on this trip, so there is nothing to rate yet.
              </p>
            ) : (
              <div className="mt-4 grid gap-4">
                {rows.map((row) => {
                  const option = findOption(bookedSegments, row.optionValue);
                  return (
                    <div key={row.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <label className="grid gap-2 text-sm font-bold text-slate-700">
                          <span>Booked item</span>
                          <select
                            value={row.optionValue}
                            onChange={(event) => updateRow(row.key, { optionValue: event.target.value })}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-ink shadow-sm"
                          >
                            <option value="">Choose a booked item…</option>
                            {bookedSegments.map((booked) => (
                              <option key={optionValueFor(booked)} value={optionValueFor(booked)}>
                                {booked.itemType.toUpperCase()} · {booked.itemLabel}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" onClick={() => removeRow(row.key)} className="min-h-11 rounded-full border border-slate-200 px-4 text-sm font-bold text-slate-500">
                          Remove
                        </button>
                      </div>
                      {option ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <label className="grid gap-2 text-sm font-bold text-slate-700">
                            <span>Stars</span>
                            <select
                              value={row.rating ?? ""}
                              onChange={(event) => updateRow(row.key, { rating: event.target.value ? Number(event.target.value) : null })}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm"
                            >
                              <option value="">Not rated</option>
                              {[1, 2, 3, 4, 5].map((score) => (
                                <option key={score} value={score}>{score} ★</option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm font-bold text-slate-700">
                            <span>Verdict</span>
                            <select
                              value={row.verdict}
                              onChange={(event) => updateRow(row.key, { verdict: event.target.value as VerdictRow["verdict"] })}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm"
                            >
                              <option value="">No verdict</option>
                              <option value="loved">Loved it</option>
                              <option value="fine">Fine</option>
                              <option value="avoid">Avoid</option>
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm font-bold text-slate-700">
                            <span>Note</span>
                            <input
                              value={row.note}
                              onChange={(event) => updateRow(row.key, { note: event.target.value })}
                              maxLength={1000}
                              placeholder="One line for future travelers…"
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-sm"
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <button type="button" onClick={addRow} className="min-h-11 self-start rounded-full border border-ocean/30 px-5 text-sm font-bold text-ocean">
                  + Rate another booked item
                </button>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-[#e8dfd0] bg-white/80 px-5 py-6 shadow-[0_12px_34px_rgba(16,32,51,0.05)] sm:px-7">
            <label className="flex cursor-pointer items-start gap-3 text-sm font-semibold leading-6 text-slate-700">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1 h-5 w-5 accent-[#0f766e]"
              />
              <span>
                I consent to Roamly reusing this itinerary <strong>anonymously</strong> in suggestions for
                future travelers (no name, no contact details, no booking references ever shared).
              </span>
            </label>
            {error ? (
              <p className="mt-4 rounded-2xl border border-coral/30 bg-coral/10 px-4 py-3 text-sm font-bold text-coral">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !ratedRows.length}
              className="mt-5 inline-flex min-h-12 items-center rounded-full bg-ocean px-6 text-sm font-black text-white disabled:opacity-50"
            >
              {submitting ? "Sharing…" : "Share my proven itinerary"}
            </button>
          </section>
        </>
      ) : null}
    </form>
  );
}
