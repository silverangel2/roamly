"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  normalizeLocale,
  supportedLocales,
  translateExactText,
  translateKey,
  type RoamlyLocale
} from "@/lib/i18n";

type I18nContextValue = {
  locale: RoamlyLocale;
  setLocale: (locale: RoamlyLocale) => void;
  t: (key: string, fallback?: string) => string;
  translateText: (text: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function cookieLocale() {
  if (typeof document === "undefined") return "";
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("roamly_lang="))
    ?.split("=")[1];
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<RoamlyLocale>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem("roamly_lang") || cookieLocale();
    setLocaleState(stored ? normalizeLocale(stored) : "en");
  }, []);

  const setLocale = (nextLocale: RoamlyLocale) => {
    const safeLocale = supportedLocales.includes(nextLocale) ? nextLocale : normalizeLocale(nextLocale);
    setLocaleState(safeLocale);
    window.localStorage.setItem("roamly_lang", safeLocale);
    document.cookie = `roamly_lang=${safeLocale}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = safeLocale;
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, fallback) => translateKey(locale, key, fallback),
      translateText: (text) => translateExactText(locale, text)
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
