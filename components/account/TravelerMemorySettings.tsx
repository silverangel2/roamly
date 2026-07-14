"use client";

import { useEffect, useMemo, useState } from "react";

type MemoryProfile = {
  personalization_enabled?: boolean;
  preferred_travel_pace?: string | null;
  maximum_comfortable_driving_hours?: number | null;
  transportation_preferences?: string[];
  accommodation_types?: string[];
  hotel_priorities?: string[];
  preferred_neighbourhood_style?: string | null;
  food_interests?: string[];
  culture_interests?: string[];
  nature_interests?: string[];
  walking_tolerance?: string | null;
  room_preferences?: string[];
  typical_budget_level?: string | null;
  likes?: string[];
  dislikes?: string[];
};

type PreferenceEvent = {
  id: string;
  preference_key: string;
  proposed_value: unknown;
  reason?: string | null;
  confidence?: number | null;
  status: string;
};

const arrayFields = [
  "transportation_preferences",
  "accommodation_types",
  "hotel_priorities",
  "food_interests",
  "culture_interests",
  "nature_interests",
  "room_preferences",
  "likes",
  "dislikes"
] as const;

const textFields = [
  "preferred_travel_pace",
  "preferred_neighbourhood_style",
  "walking_tolerance",
  "typical_budget_level"
] as const;

const labels: Record<string, string> = {
  preferred_travel_pace: "Travel pace",
  maximum_comfortable_driving_hours: "Max driving hours",
  transportation_preferences: "Transport",
  accommodation_types: "Accommodation",
  hotel_priorities: "Hotel priorities",
  preferred_neighbourhood_style: "Neighbourhood style",
  food_interests: "Food",
  culture_interests: "Culture",
  nature_interests: "Nature",
  walking_tolerance: "Walking tolerance",
  room_preferences: "Room features",
  typical_budget_level: "Budget level",
  likes: "Likes",
  dislikes: "Dislikes"
};

function asCsv(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : "";
}

function asDisplay(value: unknown) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(", ");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function TravelerMemorySettings() {
  const [profile, setProfile] = useState<MemoryProfile | null>(null);
  const [events, setEvents] = useState<PreferenceEvent[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/account/traveler-memory", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Could not load traveler memory.");
    const nextProfile = (data.profile || null) as MemoryProfile | null;
    setProfile(nextProfile);
    setEvents(Array.isArray(data.events) ? data.events : []);
    setForm({
      preferred_travel_pace: nextProfile?.preferred_travel_pace || "",
      maximum_comfortable_driving_hours:
        nextProfile?.maximum_comfortable_driving_hours === null || nextProfile?.maximum_comfortable_driving_hours === undefined
          ? ""
          : String(nextProfile.maximum_comfortable_driving_hours),
      preferred_neighbourhood_style: nextProfile?.preferred_neighbourhood_style || "",
      walking_tolerance: nextProfile?.walking_tolerance || "",
      typical_budget_level: nextProfile?.typical_budget_level || "",
      ...Object.fromEntries(arrayFields.map((field) => [field, asCsv(nextProfile?.[field])]))
    });
  }

  useEffect(() => {
    let alive = true;
    void load().catch((err) => {
      if (alive) setError(err instanceof Error ? err.message : "Could not load traveler memory.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const proposedEvents = useMemo(() => events.filter((event) => event.status === "proposed"), [events]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await action();
      await load();
      setNotice(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    await run(async () => {
      const preferences: Record<string, unknown> = {
        ...Object.fromEntries(textFields.map((field) => [field, form[field] || null])),
        maximum_comfortable_driving_hours: form.maximum_comfortable_driving_hours ? Number(form.maximum_comfortable_driving_hours) : null,
        ...Object.fromEntries(arrayFields.map((field) => [field, parseCsv(form[field] || "")]))
      };
      const response = await fetch("/api/account/traveler-memory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferences })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not save traveler memory.");
    }, "Travel memory saved.");
  }

  async function setPersonalization(enabled: boolean) {
    await run(async () => {
      const response = await fetch("/api/account/traveler-memory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personalizationEnabled: enabled })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update personalization.");
    }, enabled ? "Personalization enabled." : "Personalization disabled.");
  }

  async function updateEvent(eventId: string, status: "accepted" | "rejected" | "reverted") {
    await run(async () => {
      const response = await fetch("/api/account/traveler-memory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "event_status", eventId, status })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update learned preference.");
    }, "Learned preference updated.");
  }

  async function deletePreference(key: string) {
    await run(async () => {
      const response = await fetch("/api/account/traveler-memory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_preference", key })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not delete preference.");
    }, "Preference deleted.");
  }

  async function deleteAll() {
    await run(async () => {
      const response = await fetch("/api/account/traveler-memory", { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not delete travel memory.");
    }, "Travel memory deleted.");
  }

  const personalization = profile?.personalization_enabled !== false;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-mist p-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Here is what Roamly remembers</p>
          <p className="mt-1 text-sm font-bold text-slate-600">{personalization ? "Personalization is on." : "Personalization is off."}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPersonalization(!personalization)}
          className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud transition hover:ring-ocean/30 disabled:opacity-60"
        >
          {personalization ? "Turn off" : "Turn on"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[...textFields, "maximum_comfortable_driving_hours" as const].map((field) => (
          <label key={field} className="block">
            <span className="text-sm font-black text-ink">{labels[field]}</span>
            <input
              value={form[field] || ""}
              onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
            />
          </label>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {arrayFields.map((field) => (
          <label key={field} className="block">
            <span className="flex items-center justify-between gap-3 text-sm font-black text-ink">
              {labels[field]}
              {form[field] ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => deletePreference(field)}
                  className="text-xs font-black uppercase tracking-[0.12em] text-coral"
                >
                  Delete
                </button>
              ) : null}
            </span>
            <input
              value={form[field] || ""}
              onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
            />
          </label>
        ))}
      </div>

      {proposedEvents.length ? (
        <div className="space-y-3 rounded-2xl border border-cloud bg-white p-4">
          <p className="text-sm font-black text-ink">Here is what Roamly learned from your trip.</p>
          {proposedEvents.map((event) => (
            <div key={event.id} className="rounded-2xl bg-mist p-3">
              <p className="text-sm font-black text-ink">
                {labels[event.preference_key] || event.preference_key}: {asDisplay(event.proposed_value)}
              </p>
              {event.reason ? <p className="mt-1 text-xs font-bold text-slate-500">{event.reason}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => updateEvent(event.id, "accepted")} className="rounded-xl bg-ocean px-3 py-2 text-xs font-black text-white">
                  Accept
                </button>
                <button type="button" disabled={busy} onClick={() => updateEvent(event.id, "rejected")} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-ink ring-1 ring-cloud">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {notice ? <p className="rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save memory"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={deleteAll}
          className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-coral shadow-soft ring-1 ring-cloud transition hover:ring-coral/30 disabled:opacity-60"
        >
          Delete all travel memory
        </button>
      </div>
    </div>
  );
}
