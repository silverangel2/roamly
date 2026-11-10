"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiFieldError, useBuiField, type BuiField } from "@/components/boardui/Field";
import { BuiNotice } from "@/components/boardui/Notice";
import type {
  BookedSegmentOption,
  CompletedTripOption,
  ItinerarySubmissionRecord
} from "@/lib/roamly/itineraryLibrary";

/*
 * Batch 7 (2026-11-09): the share form's fields ride the BoardUI form
 * pattern (batches 3/4/6 wiring): a real visible label that never
 * leaves, the foundation `bui-input` recipe, and — for the one field
 * with a rule (Destination is required) — blur validation via
 * useBuiField with the reserved error slot, so the message appears
 * at the field on blur and the submit never moves. The submit-time
 * checks in handleSubmit are UNCHANGED, messages verbatim; the
 * form-level error still renders at the consent section, as before.
 */
const shareInputClass = (errored: boolean) =>
  `bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
    errored ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"
  }`;

function ShareField({
  id,
  label,
  value,
  onChange,
  field,
  type = "text",
  placeholder = "",
  maxLength
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  field?: BuiField;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className={field && field.shakeKey > 0 ? "bui-shake block" : "block"}>
      <span className="text-sm font-black text-chead">{label}</span>
      <input
        id={id}
        value={value}
        type={type}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => {
          onChange(event.target.value);
          field?.onChange(event.target.value);
        }}
        onBlur={field ? () => field.onBlur(value) : undefined}
        aria-invalid={field?.error ? true : undefined}
        aria-describedby={field?.error ? `${id}-error` : undefined}
        className={shareInputClass(Boolean(field?.error))}
      />
      {field ? <BuiFieldError id={`${id}-error`} message={field.error} /> : null}
    </label>
  );
}

function ShareSelectField({
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
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={shareInputClass(false)}>
        {children}
      </select>
    </label>
  );
}

function ShareAreaField({
  id,
  label,
  value,
  onChange,
  placeholder = "",
  maxLength,
  rows = 4
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-chead">{label}</span>
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className={shareInputClass(false)}
      />
    </label>
  );
}

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
  // The form's one field-level rule, word-for-word the submit check's
  // message: blur surfaces it at the field; the submit check stands.
  const destinationField = useBuiField((value) => (value.trim() ? "" : "Destination is required."));
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
      <BuiCard className="px-6 py-10 text-center">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Shared</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-chead">Thanks — your proven itinerary is in the library.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-cink">
          {consent
            ? "You consented to anonymized reuse, so future travelers heading the same way may benefit from what you learned."
            : "You did not consent to anonymized reuse, so this stays as your personal record only."}
        </p>
        <BuiButtonLink href={selectedTripId ? `/trip/${selectedTripId}` : "/dashboard"} className="mt-6">
          Back to your trip
        </BuiButtonLink>
      </BuiCard>
    );
  }

  if (existingSubmission) {
    return (
      <BuiCard className="px-6 py-10 text-center">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Already shared</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-chead">This trip is already in the library.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-cink">
          One submission per completed trip keeps the library honest. Shared{" "}
          {existingSubmission.created_at ? new Date(existingSubmission.created_at).toLocaleDateString() : "earlier"}.
        </p>
        <BuiButtonLink href={`/trip/${existingSubmission.trip_id}`} className="mt-6">
          View your trip
        </BuiButtonLink>
      </BuiCard>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <BuiCard className="px-5 py-6 sm:px-7">
        <h2 className="text-lg font-black text-chead">Which trip?</h2>
        {trips.length === 0 ? (
          <p className="mt-2 text-sm font-semibold leading-6 text-cink">
            You have no completed trips yet. Once a trip is marked completed, it will appear here.
          </p>
        ) : (
          <div className="mt-3">
            <ShareSelectField
              id="share-trip"
              label="Completed trip"
              value={selectedTripId || ""}
              onChange={(value) => router.push(value ? `/trips/share?trip=${value}` : "/trips/share")}
            >
              <option value="">Choose a completed trip…</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>{tripLabel(trip)}</option>
              ))}
            </ShareSelectField>
          </div>
        )}
      </BuiCard>

      {selectedTripId ? (
        <>
          <BuiCard className="px-5 py-6 sm:px-7">
            <h2 className="text-lg font-black text-chead">The trip</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <ShareField id="share-title" label="Trip title" value={title} onChange={setTitle} maxLength={160} placeholder="e.g. Slow week in Lisbon" />
              <ShareField id="share-destination" label="Destination *" value={destination} onChange={setDestination} maxLength={200} field={destinationField} />
              <ShareField id="share-start-date" label="Start date" type="date" value={startDate} onChange={setStartDate} />
              <ShareField id="share-end-date" label="End date" type="date" value={endDate} onChange={setEndDate} />
            </div>
            <div className="mt-4">
              <ShareAreaField id="share-highlights" label="What made this trip eventful / fruitful?" value={highlights} onChange={setHighlights} maxLength={4000} rows={4} placeholder="The moments, places, or decisions future travelers should know about…" />
            </div>
          </BuiCard>

          <BuiCard className="px-5 py-6 sm:px-7">
            <h2 className="text-lg font-black text-chead">Rate what you booked</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-cink">
              Only items from your own booking wallet appear here — every rating is booking-proof.
            </p>
            {segmentsError ? (
              <BuiNotice tone="error" title={`Could not load your bookings: ${segmentsError}`} className="mt-3" />
            ) : bookedSegments.length === 0 ? (
              <p className="mt-3 text-sm font-semibold leading-6 text-cink">
                No bookings found on this trip, so there is nothing to rate yet.
              </p>
            ) : (
              <div className="mt-4 grid gap-4">
                {rows.map((row) => {
                  const option = findOption(bookedSegments, row.optionValue);
                  return (
                    <BuiCard key={row.key} className="px-4 py-4">
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <ShareSelectField
                          id={`share-row-${row.key}-item`}
                          label="Booked item"
                          value={row.optionValue}
                          onChange={(value) => updateRow(row.key, { optionValue: value })}
                        >
                          <option value="">Choose a booked item…</option>
                          {bookedSegments.map((booked) => (
                            <option key={optionValueFor(booked)} value={optionValueFor(booked)}>
                              {booked.itemType.toUpperCase()} · {booked.itemLabel}
                            </option>
                          ))}
                        </ShareSelectField>
                        <BuiButton type="button" variant="secondary" onClick={() => removeRow(row.key)}>
                          Remove
                        </BuiButton>
                      </div>
                      {option ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <ShareSelectField
                            id={`share-row-${row.key}-stars`}
                            label="Stars"
                            value={String(row.rating ?? "")}
                            onChange={(value) => updateRow(row.key, { rating: value ? Number(value) : null })}
                          >
                            <option value="">Not rated</option>
                            {[1, 2, 3, 4, 5].map((score) => (
                              <option key={score} value={score}>{score} ★</option>
                            ))}
                          </ShareSelectField>
                          <ShareSelectField
                            id={`share-row-${row.key}-verdict`}
                            label="Verdict"
                            value={row.verdict}
                            onChange={(value) => updateRow(row.key, { verdict: value as VerdictRow["verdict"] })}
                          >
                            <option value="">No verdict</option>
                            <option value="loved">Loved it</option>
                            <option value="fine">Fine</option>
                            <option value="avoid">Avoid</option>
                          </ShareSelectField>
                          <ShareField
                            id={`share-row-${row.key}-note`}
                            label="Note"
                            value={row.note}
                            onChange={(value) => updateRow(row.key, { note: value })}
                            maxLength={1000}
                            placeholder="One line for future travelers…"
                          />
                        </div>
                      ) : null}
                    </BuiCard>
                  );
                })}
                <BuiButton type="button" variant="secondary" onClick={addRow} className="self-start">
                  + Rate another booked item
                </BuiButton>
              </div>
            )}
          </BuiCard>

          <BuiCard className="px-5 py-6 sm:px-7">
            <label className="flex cursor-pointer items-start gap-3 text-sm font-semibold leading-6 text-cink">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-cblue"
              />
              <span>
                I consent to Roamly reusing this itinerary <strong>anonymously</strong> in suggestions for
                future travelers (no name, no contact details, no booking references ever shared).
              </span>
            </label>
            {error ? <BuiNotice tone="error" title={error} className="mt-4" /> : null}
            <BuiButton
              type="submit"
              disabled={submitting || !ratedRows.length}
              busy={submitting}
              className="mt-5"
            >
              {submitting ? "Sharing…" : "Share my proven itinerary"}
            </BuiButton>
          </BuiCard>
        </>
      ) : null}
    </form>
  );
}
