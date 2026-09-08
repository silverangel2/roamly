import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import ja from "@/messages/ja.json";
import ko from "@/messages/ko.json";
import zh from "@/messages/zh.json";

export const supportedLocales = ["en", "fr", "es", "ja", "ko", "zh"] as const;
export type RoamlyLocale = (typeof supportedLocales)[number];
export const ROAMLY_LOCALE_COOKIE = "roamly_lang";
export const ROAMLY_LOCALE_STORAGE_KEY = "roamly_lang";
export const ROAMLY_DEFAULT_LOCALE: RoamlyLocale = "en";

const intlLocales: Record<RoamlyLocale, string> = {
  en: "en-CA",
  fr: "fr-CA",
  es: "es-ES",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN"
};

/**
 * Roamly's locale contract: explicit selection, then persisted selection,
 * then browser preference, then the documented English fallback.
 * Provider names, brands, addresses, airport codes, URLs, and other official
 * proper nouns are data and must not be translated by these helpers.
 */
export type RoamlyLocaleResolutionInput = {
  explicitLocale?: string | null;
  persistedLocale?: string | null;
  storedLocale?: string | null;
  browserLocale?: string | null;
};

type MessageBundle = typeof en;

export const roamlyMessages: Record<RoamlyLocale, MessageBundle> = {
  en,
  fr,
  es,
  ja,
  ko,
  zh
};

export function normalizeLocale(value?: string | null): RoamlyLocale {
  const normalized = (value || "").trim().toLowerCase().replace(/_/g, "-");
  const short = normalized.split("-")[0];
  return supportedLocales.includes(short as RoamlyLocale) ? (short as RoamlyLocale) : ROAMLY_DEFAULT_LOCALE;
}

export function detectBrowserLocale(language?: string | null): RoamlyLocale {
  return normalizeLocale(language || ROAMLY_DEFAULT_LOCALE);
}

export function resolveRoamlyLocale(input: RoamlyLocaleResolutionInput = {}): RoamlyLocale {
  const candidates = [
    input.explicitLocale,
    input.persistedLocale,
    input.storedLocale,
    input.browserLocale
  ];
  const selected = candidates.find((value) => {
    if (!value || !value.trim()) return false;
    const normalized = value.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
    return supportedLocales.includes(normalized as RoamlyLocale);
  });
  return selected ? normalizeLocale(selected) : ROAMLY_DEFAULT_LOCALE;
}

export function roamlyIntlLocale(locale: RoamlyLocale | string | null | undefined): string {
  return intlLocales[normalizeLocale(locale)] || intlLocales[ROAMLY_DEFAULT_LOCALE];
}

export function formatRoamlyDate(
  value: Date | number | string,
  locale: RoamlyLocale | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
) {
  return new Intl.DateTimeFormat(roamlyIntlLocale(locale), options).format(new Date(value));
}

export function formatRoamlyTime(
  value: Date | number | string,
  locale: RoamlyLocale | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
) {
  return new Intl.DateTimeFormat(roamlyIntlLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
    ...options
  }).format(new Date(value));
}

export function formatRoamlyNumber(
  value: number,
  locale: RoamlyLocale | string | null | undefined,
  options: Intl.NumberFormatOptions = {}
) {
  return new Intl.NumberFormat(roamlyIntlLocale(locale), options).format(value);
}

export function formatRoamlyCurrency(
  value: number,
  currency: string,
  locale: RoamlyLocale | string | null | undefined,
  options: Intl.NumberFormatOptions = {}
) {
  return new Intl.NumberFormat(roamlyIntlLocale(locale), {
    style: "currency",
    currency,
    ...options
  }).format(value);
}

export function interpolateRoamlyMessage(message: string, values: Record<string, string | number> = {}) {
  return message.replace(/\{([\w.-]+)\}/g, (token, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token
  );
}

function getNestedValue(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

export function translateKey(
  locale: RoamlyLocale,
  key: string,
  fallback = "",
  values: Record<string, string | number> = {}
) {
  const value = getNestedValue(roamlyMessages[locale], key) ??
    (key.startsWith("ui.booking.") ? getNestedValue(roamlyMessages[locale], key.replace("ui.booking.", "ui.email.booking.")) : undefined);
  if (typeof value === "string") return interpolateRoamlyMessage(value, values);
  const english = getNestedValue(roamlyMessages.en, key) ??
    (key.startsWith("ui.booking.") ? getNestedValue(roamlyMessages.en, key.replace("ui.booking.", "ui.email.booking.")) : undefined);
  if (typeof english === "string") return interpolateRoamlyMessage(english, values);
  if (fallback) return interpolateRoamlyMessage(fallback, values);
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[Roamly i18n] Missing translation key: ${key}`);
  }
  return key;
}

function findUiPathForEnglishText(text: string, source: unknown = roamlyMessages.en.ui, path = "ui"): string | null {
  if (!source || typeof source !== "object") return null;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (typeof value === "string" && value === text) return nextPath;
    const nested = findUiPathForEnglishText(text, value, nextPath);
    if (nested) return nested;
  }
  return null;
}

export function translateExactText(locale: RoamlyLocale, text: string) {
  if (locale === "en") return text;
  const translated = roamlyMessages[locale].text[text as keyof typeof en.text];
  if (translated) return translated;
  const uiPath = findUiPathForEnglishText(text);
  return uiPath ? translateKey(locale, uiPath, text) : text;
}

export function localizeCustomerError(
  locale: RoamlyLocale,
  error: unknown,
  fallbackKey = "ui.status.unexpectedError"
) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (locale === "en" && message) return message;
  const translated = message ? translateExactText(locale, message) : "";
  if (translated && translated !== message) return translated;
  return translateKey(locale, fallbackKey, "Something went wrong.");
}
