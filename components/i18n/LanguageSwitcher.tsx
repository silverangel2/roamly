"use client";

import { roamlyMessages, supportedLocales, type RoamlyLocale } from "@/lib/i18n";
import { Globe } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="relative flex h-8 items-center gap-1 rounded-full bg-white/70 px-2 text-[0.7rem] font-medium text-[#526b6c] ring-1 ring-black/5 dark:bg-slate-900/80 dark:text-white/80 dark:ring-white/10 sm:h-9 sm:gap-1.5 sm:px-2.5 sm:text-xs">
      <span className="sr-only">{t("ui.language", "Language")}</span>
      <Globe aria-hidden="true" className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" strokeWidth={1.8} />
      <span aria-hidden="true" className="tracking-wide sm:hidden">
        {locale.toUpperCase()}
      </span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as RoamlyLocale)}
        className="absolute inset-0 cursor-pointer opacity-0 sm:static sm:inset-auto sm:max-w-[8rem] sm:bg-transparent sm:font-medium sm:text-ink sm:opacity-100 sm:outline-none sm:dark:text-white"
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
