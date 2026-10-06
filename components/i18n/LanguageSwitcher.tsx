"use client";

import { roamlyMessages, supportedLocales, type RoamlyLocale } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="flex h-9 items-center gap-1.5 rounded-full bg-white/80 px-2 text-xs font-semibold text-ink ring-1 ring-black/5 dark:bg-slate-900 dark:text-white dark:ring-white/10">
      <span className="sr-only">{t("ui.language", "Language")}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#526b6c]" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9S9.5 5.8 12 3z" />
      </svg>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as RoamlyLocale)}
        className="bg-transparent text-xs font-semibold text-ink outline-none dark:text-white"
        aria-label={t("ui.language", "Language")}
      >
        {supportedLocales.map((item) => (
          <option key={item} value={item}>
            {roamlyMessages[item].languageName}
          </option>
        ))}
      </select>
    </label>
  );
}
