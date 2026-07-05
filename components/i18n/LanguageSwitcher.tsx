"use client";

import { roamlyMessages, supportedLocales, type RoamlyLocale } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-black text-ink shadow-soft ring-1 ring-cloud">
      <span className="sr-only">{t("ui.language", "Language")}</span>
      <span aria-hidden="true">{t("ui.language", "Language")}</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as RoamlyLocale)}
        className="bg-transparent text-xs font-black text-ink outline-none"
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
