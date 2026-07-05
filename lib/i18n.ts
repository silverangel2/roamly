import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import ja from "@/messages/ja.json";
import ko from "@/messages/ko.json";
import zh from "@/messages/zh.json";

export const supportedLocales = ["en", "fr", "es", "ja", "ko", "zh"] as const;
export type RoamlyLocale = (typeof supportedLocales)[number];

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
  const normalized = (value || "").toLowerCase();
  const short = normalized.split("-")[0];
  return supportedLocales.includes(short as RoamlyLocale) ? (short as RoamlyLocale) : "en";
}

export function detectBrowserLocale(language?: string | null): RoamlyLocale {
  return normalizeLocale(language || "en");
}

function getNestedValue(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

export function translateKey(locale: RoamlyLocale, key: string, fallback = "") {
  const value = getNestedValue(roamlyMessages[locale], key);
  if (typeof value === "string") return value;
  const english = getNestedValue(roamlyMessages.en, key);
  return typeof english === "string" ? english : fallback || key;
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
