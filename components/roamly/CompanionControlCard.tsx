"use client";

import { useEffect, useState } from "react";

type CompanionControlMode =
  | "suggest_changes"
  | "fix_simple_changes"
  | "fix_within_rules";

type Preferences = {
  controlMode: CompanionControlMode;
  allowFreeScheduleChanges: boolean;
  allowOptionalActivityChanges: boolean;
  allowMealChanges: boolean;
  allowRouteTimeUpdates: boolean;
  maxAutomaticCostChange: number;
  currency: string | null;
};

type ModeOption = {
  value: CompanionControlMode;
  title: string;
  description: string;
};

const OPTIONS: ModeOption[] = [
  {
    value: "suggest_changes",
    title: "Suggest changes",
    description: "Roamly asks before changing your itinerary."
  },
  {
    value: "fix_simple_changes",
    title: "Fix simple changes",
    description: "Roamly may adjust free, low-risk timing and flexible plans."
  },
  {
    value: "fix_within_rules",
    title: "Fix within my rules",
    description: "Roamly may make approved changes within your limits."
  }
];

export function CompanionControlCard({
  tripId
}: {
  tripId: string;
}) {
  const [preferences, setPreferences] =
    useState<Preferences | null>(null);
  const [selectedMode, setSelectedMode] =
    useState<CompanionControlMode>("suggest_changes");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      try {
        const response = await fetch(
          `/api/trips/${tripId}/companion/preferences`,
          {
            credentials: "include",
            cache: "no-store"
          }
        );

        const result = await response.json();

        if (!response.ok || !result?.ok) {
          throw new Error(
            result?.error || "Could not load Companion settings."
          );
        }

        if (!cancelled) {
          setPreferences(result.preferences);
          setSelectedMode(result.preferences.controlMode);
        }
      } catch {
        if (!cancelled) {
          setMessage("Companion settings could not be loaded.");
        }
      }
    }

    loadPreferences();

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function saveMode(mode: CompanionControlMode) {
    const previousMode = selectedMode;

    setSelectedMode(mode);
    setSaving(true);
    setMessage(null);

    try {
      const current = preferences;

      const response = await fetch(
        `/api/trips/${tripId}/companion/preferences`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            controlMode: mode,
            allowFreeScheduleChanges:
              mode === "fix_simple_changes" ||
              mode === "fix_within_rules",
            allowOptionalActivityChanges:
              mode === "fix_simple_changes" ||
              mode === "fix_within_rules",
            allowMealChanges:
              mode === "fix_simple_changes" ||
              mode === "fix_within_rules",
            allowRouteTimeUpdates:
              mode === "fix_simple_changes" ||
              mode === "fix_within_rules",
            maxAutomaticCostChange:
              mode === "fix_within_rules"
                ? current?.maxAutomaticCostChange || 0
                : 0,
            currency: current?.currency || null
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.error || "Could not save Companion settings."
        );
      }

      setPreferences(result.preferences);
      setSelectedMode(result.preferences.controlMode);
      setMessage("Companion preference saved.");
    } catch {
      setSelectedMode(previousMode);
      setMessage("Your setting was not saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="companion-control-title"
      className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
            Companion control
          </p>
          <h2
            id="companion-control-title"
            className="mt-2 text-xl font-black text-ink"
          >
            How should Roamly help?
          </h2>
        </div>

        {saving ? (
          <span className="text-xs font-bold text-slate-500">
            Saving…
          </span>
        ) : null}
      </div>

      <div
        className="mt-4 grid gap-2"
        role="radiogroup"
        aria-label="Companion control mode"
      >
        {OPTIONS.map((option) => {
          const selected = selectedMode === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => saveMode(option.value)}
              className={[
                "w-full rounded-2xl border px-4 py-3 text-left transition",
                "focus:outline-none focus:ring-2 focus:ring-ocean focus:ring-offset-2",
                selected
                  ? "border-ocean bg-sky-50"
                  : "border-slate-200 bg-white hover:bg-mist",
                saving ? "cursor-wait opacity-70" : ""
              ].join(" ")}
            >
              <span className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={[
                    "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                    selected
                      ? "border-ocean"
                      : "border-slate-300"
                  ].join(" ")}
                >
                  {selected ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-ocean" />
                  ) : null}
                </span>

                <span>
                  <span className="block text-sm font-black text-ink">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">
                    {option.description}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {message ? (
        <p
          className="mt-3 text-xs font-bold text-slate-500"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
