"use client";

import { useState } from "react";
import { PackageChangeForm, PackageChangeRow, packageFieldClass, packageLabelClass, packagePrimaryClass, packageQuietClass } from "@/components/roamly/packageChangeChrome";

type Props = {
  tripId: string;
  status: string;
  adults: number;
  childrenCount: number;
  infants: number;
  travelStyle: string;
  interests: string[];
  accommodationPreference: string;
  transportationPreference: string;
  pace: string;
  walkingTolerance: string;
  specialNotes: string;
};

type Proposal = { id: string; requested_intent_snapshot?: { travelers?: { adults?: number; children?: number; infants?: number }; travelStyle?: string; interests?: string[] }; result?: { changedFields?: string[]; bookingReviewRequired?: boolean } };

function travelerValue(adults: number, childrenCount: number, infants: number) {
  const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
  if (childrenCount) parts.push(`${childrenCount} ${childrenCount === 1 ? "child" : "children"}`);
  if (infants) parts.push(`${infants} ${infants === 1 ? "infant" : "infants"}`);
  return parts.join(", ");
}

export default function CustomerTripIntentChange(props: Props) {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [adults, setAdults] = useState(String(props.adults));
  const [children, setChildren] = useState(String(props.childrenCount));
  const [infants, setInfants] = useState(String(props.infants));
  const [travelStyle, setTravelStyle] = useState(props.travelStyle || "Balanced");
  const [interests, setInterests] = useState(props.interests.join(", "));
  const [accommodationPreference, setAccommodationPreference] = useState(props.accommodationPreference || "Not sure");
  const [transportationPreference, setTransportationPreference] = useState(props.transportationPreference || "Mixed");
  const [pace, setPace] = useState(props.pace || "Balanced");
  const [walkingTolerance, setWalkingTolerance] = useState(props.walkingTolerance || "Medium");
  const [specialNotes, setSpecialNotes] = useState(props.specialNotes || "");
  if (!["generated", "locked", "planned"].includes(props.status)) return null;

  async function preview() {
    const composition = { adults: Number(adults), children: Number(children), infants: Number(infants) };
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${props.tripId}/intent-change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { travelers: composition, travelStyle, interests: interests.split(",").map((item) => item.trim()).filter(Boolean), accommodationPreference, transportationPreference, pace, walkingTolerance, specialNotes: specialNotes || null } }) });
      const body = await response.json();
      if (!response.ok || !body.proposal) throw new Error(body.message || body.error || "Intent preview unavailable.");
      setProposal(body.proposal);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Intent preview unavailable."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${props.tripId}/intent-change/${proposal.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The new itinerary could not be started.");
      window.location.href = `/trip/${body.successorTripId}?generating=1`;
    } catch (error) { setMessage(error instanceof Error ? error.message : "The new itinerary could not be started."); }
    finally { setBusy(false); }
  }

  const requested = proposal?.requested_intent_snapshot;
  const fields: Array<[string, string, (value: string) => void]> = [
    ["Travel style", travelStyle, setTravelStyle],
    ["Pace", pace, setPace],
    ["Walking tolerance", walkingTolerance, setWalkingTolerance],
    ["Accommodation", accommodationPreference, setAccommodationPreference],
    ["Transportation", transportationPreference, setTransportationPreference]
  ];

  return (
    <div className="roamly-no-print">
      {!open ? (
        <PackageChangeRow
          label="Travelers"
          value={travelerValue(props.adults, props.childrenCount, props.infants)}
          actionLabel="Change travelers & preferences"
          onOpen={() => setOpen(true)}
        />
      ) : (
        <PackageChangeForm onCancel={() => { setOpen(false); setProposal(null); }}>
          <p className="text-[0.9375rem] font-semibold tracking-tight text-ink">Change travelers &amp; preferences</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">Roamly will make a fresh grounded plan while keeping your destination, dates, and budget unchanged. Existing bookings stay attached to this current trip and are not moved.</p>
          {!proposal ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {([["Adults", adults, setAdults], ["Children", children, setChildren], ["Infants", infants, setInfants]] as const).map(([label, value, setter]) => (
                  <label key={label} className={packageLabelClass}>
                    {label}
                    <input type="number" min="0" value={value} onChange={(event) => setter(event.target.value)} className={packageFieldClass} />
                  </label>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {fields.map(([label, value, setter]) => (
                  <label key={label} className={packageLabelClass}>
                    {label}
                    <input value={value} onChange={(event) => setter(event.target.value)} className={packageFieldClass} />
                  </label>
                ))}
              </div>
              <label className={`mt-3 block ${packageLabelClass}`}>
                Interests, separated by commas
                <input value={interests} onChange={(event) => setInterests(event.target.value)} className={packageFieldClass} />
              </label>
              <label className={`mt-3 block ${packageLabelClass}`}>
                Special planning notes
                <textarea value={specialNotes} onChange={(event) => setSpecialNotes(event.target.value)} className={`${packageFieldClass} min-h-20 py-2`} />
              </label>
              <button type="button" onClick={preview} disabled={busy} className={`mt-4 ${packagePrimaryClass}`}>{busy ? "Checking…" : "Preview change"}</button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm font-medium text-slate-700">New composition: {requested?.travelers?.adults || 0} adults, {requested?.travelers?.children || 0} children, {requested?.travelers?.infants || 0} infants.</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Companion traveler details are not copied into the new trip. Re-enter any required passport details after the new slots are created. Your current itinerary remains intact until fresh generation succeeds.</p>
              {proposal.result?.bookingReviewRequired ? <p className="mt-2 text-sm font-medium text-amber-800">Existing non-confirmed booking activity was found. Review those bookings before relying on the fresh plan; Roamly will not move them.</p> : null}
              <div className="mt-4 flex flex-wrap items-center gap-1">
                <button type="button" onClick={apply} disabled={busy} className={packagePrimaryClass}>{busy ? "Starting…" : "Approve and create fresh plan"}</button>
                <button type="button" onClick={() => setProposal(null)} disabled={busy} className={packageQuietClass}>Review again</button>
              </div>
            </>
          )}
          {message ? <p className="mt-3 text-sm text-amber-800" aria-live="polite">{message}</p> : null}
        </PackageChangeForm>
      )}
    </div>
  );
}
