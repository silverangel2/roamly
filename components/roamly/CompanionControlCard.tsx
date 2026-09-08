"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

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
  liveCompanionEnabled: boolean;
  liveCompanionPausedUntil: string | null;
  backgroundLocationEnabled: boolean;
};

type ModeOption = {
  value: CompanionControlMode;
  title: string;
  description: string;
};

const OPTIONS: ModeOption[] = [
  {
    value: "suggest_changes",
    title: "suggestChanges",
    description: "suggestChangesDescription"
  },
  {
    value: "fix_simple_changes",
    title: "fixSimpleChanges",
    description: "fixSimpleChangesDescription"
  },
  {
    value: "fix_within_rules",
    title: "fixWithinRules",
    description: "fixWithinRulesDescription"
  }
];

export function CompanionControlCard({
  tripId
}: {
  tripId: string;
}) {
  const { t } = useI18n();
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
            result?.error || t("ui.status.companionLoadFailed")
          );
        }

        if (!cancelled) {
          setPreferences(result.preferences);
          setSelectedMode(result.preferences.controlMode);
        }
      } catch {
        if (!cancelled) {
          setMessage(t("ui.status.companionLoadFailed"));
        }
      }
    }

    loadPreferences();

    return () => {
      cancelled = true;
    };
  }, [t, tripId]);

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
          result?.error || t("ui.status.companionSaveFailed")
        );
      }

      setPreferences(result.preferences);
      setSelectedMode(result.preferences.controlMode);
      setMessage(t("ui.status.companionSaved"));
    } catch {
      setSelectedMode(previousMode);
      setMessage(t("ui.status.settingNotSaved"));
    } finally {
      setSaving(false);
    }
  }

  async function saveLiveControls(patch: Partial<Preferences>, successMessage: string) {
    const previous = preferences;
    const next = {
      ...(preferences || {
        controlMode: selectedMode,
        allowFreeScheduleChanges: false,
        allowOptionalActivityChanges: false,
        allowMealChanges: false,
        allowRouteTimeUpdates: false,
        maxAutomaticCostChange: 0,
        currency: null,
        liveCompanionEnabled: true,
        liveCompanionPausedUntil: null,
        backgroundLocationEnabled: false
      }),
      ...patch
    };

    setPreferences(next);
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/trips/${tripId}/companion/preferences`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            liveCompanionEnabled: next.liveCompanionEnabled,
            liveCompanionPausedUntil: next.liveCompanionPausedUntil,
            backgroundLocationEnabled: next.backgroundLocationEnabled
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
      setMessage(successMessage);
    } catch {
      setPreferences(previous);
      setMessage("Your setting was not saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const pausedUntil = preferences?.liveCompanionPausedUntil
    ? new Date(preferences.liveCompanionPausedUntil)
    : null;
  const isPaused = Boolean(
    pausedUntil && pausedUntil.getTime() > Date.now()
  );

  return (
    <section
      aria-labelledby="companion-control-title"
      className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
          {t("ui.status.companionControl")}
          </p>
          <h2
            id="companion-control-title"
            className="mt-2 text-xl font-black text-ink"
          >
            {t("ui.status.howCompanionHelps")}
          </h2>
        </div>

        {saving ? (
          <span className="text-xs font-bold text-slate-500">
            {t("ui.status.saving")}
          </span>
        ) : null}
      </div>

      <div
        className="mt-4 grid gap-2"
        role="radiogroup"
        aria-label={t("ui.status.companionControlMode")}
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
                    {t(`ui.status.${option.title}`)}
                  </span>
                  <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">
                    {t(`ui.status.${option.description}`)}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black text-ink">
              {t("ui.status.liveCompanion")} {" "}
              {preferences?.liveCompanionEnabled === false
                ? t("ui.status.off")
                : isPaused
                  ? t("ui.status.paused")
                  : t("ui.status.ready")}
            </p>
            <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
              {t("ui.status.pauseDescription")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button
              type="button"
              disabled={saving || !preferences}
              onClick={() =>
                saveLiveControls(
                  {
                    liveCompanionEnabled: true,
                    liveCompanionPausedUntil: new Date(Date.now() + 60 * 60_000).toISOString()
                  },
                  t("ui.status.companionPaused")
                )
              }
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60"
            >
              {t("ui.status.pause")}
            </button>
            <button
              type="button"
              disabled={saving || !preferences}
              onClick={() =>
                saveLiveControls(
                  {
                    liveCompanionEnabled: true,
                    liveCompanionPausedUntil: null
                  },
                  t("ui.status.companionResumed")
                )
              }
              className="min-h-11 rounded-2xl border border-ocean/20 bg-ocean/10 px-3 py-2 text-xs font-black text-ocean disabled:opacity-60"
            >
              {t("ui.status.resume")}
            </button>
            <button
              type="button"
              disabled={saving || !preferences}
              onClick={() =>
                saveLiveControls(
                  {
                    liveCompanionEnabled: false,
                    liveCompanionPausedUntil: null
                  },
                  t("ui.status.companionDisabled")
                )
              }
              className="min-h-11 rounded-2xl border border-coral/20 bg-coral/10 px-3 py-2 text-xs font-black text-coral disabled:opacity-60"
            >
              {t("ui.status.disable")}
            </button>
            <button
              type="button"
              disabled={saving || !preferences}
              onClick={() =>
                saveLiveControls(
                  {
                    backgroundLocationEnabled: !preferences?.backgroundLocationEnabled
                  },
                  preferences?.backgroundLocationEnabled
                    ? t("ui.status.backgroundDisabled")
                    : t("ui.status.backgroundSaved")
                )
              }
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60"
            >
              {preferences?.backgroundLocationEnabled ? t("ui.status.backgroundOn") : t("ui.status.backgroundOff")}
            </button>
          </div>
        </div>
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
