"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  ROAMLY_LOCALE_COOKIE,
  ROAMLY_LOCALE_STORAGE_KEY,
  resolveRoamlyLocale,
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
    .find((item) => item.startsWith(`${ROAMLY_LOCALE_COOKIE}=`))
    ?.split("=")[1];
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<RoamlyLocale>("en");

  useEffect(() => {
    const cookie = cookieLocale();
    const stored = window.localStorage.getItem(ROAMLY_LOCALE_STORAGE_KEY);
    setLocaleState(resolveRoamlyLocale({
      persistedLocale: cookie,
      storedLocale: stored,
      browserLocale: navigator.language
    }));
  }, []);

  const setLocale = (nextLocale: RoamlyLocale) => {
    const safeLocale = resolveRoamlyLocale({ explicitLocale: nextLocale });
    setLocaleState(safeLocale);
    window.localStorage.setItem(ROAMLY_LOCALE_STORAGE_KEY, safeLocale);
    document.cookie = `${ROAMLY_LOCALE_COOKIE}=${safeLocale}; path=/; max-age=31536000; samesite=lax`;
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
