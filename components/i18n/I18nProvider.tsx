"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  ROAMLY_LOCALE_COOKIE,
  ROAMLY_LOCALE_STORAGE_KEY,
  resolveRoamlyLocale,
  supportedLocales,
  translateExactText,
  translateKey,
  type RoamlyLocale
} from "@/lib/i18n";

type I18nContextValue = {
  locale: RoamlyLocale;
  setLocale: (locale: RoamlyLocale) => void;
  t: (key: string, fallback?: string, values?: Record<string, string | number>) => string;
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

export function I18nProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale?: RoamlyLocale }) {
  // Flash-of-English fix (2026-11-12): the provider used to initialise
  // to "en" and flip after hydration, so a cold load painted ~2 s of
  // English before the stored language applied. The server locale
  // (from the roamly_lang cookie) is now the initial state, so the
  // server render — the first paint — is already in the picked
  // language. The effect below only re-resolves client-side signals
  // (localStorage / browser) when the server had nothing persisted.
  const [locale, setLocaleState] = useState<RoamlyLocale>(() =>
    initialLocale && supportedLocales.includes(initialLocale) ? initialLocale : "en"
  );

  useEffect(() => {
    const cookie = cookieLocale();
    // The server already used the cookie as the provider's initial state:
    // re-resolving here could only flip a cookie-set user to a stale
    // localStorage / browser value. Re-resolve only when the server had
    // nothing persisted (no cookie) to honour.
    if (cookie) return;
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
      t: (key, fallback, values) => translateKey(locale, key, fallback, values),
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
