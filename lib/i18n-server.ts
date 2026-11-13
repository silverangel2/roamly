import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import {
  ROAMLY_DEFAULT_LOCALE,
  ROAMLY_LOCALE_COOKIE,
  resolveRoamlyLocale,
  type RoamlyLocale
} from "@/lib/i18n";

export async function getServerLocale(): Promise<RoamlyLocale> {
  const cookieStore = await cookies();
  // Flash-of-English fix (2026-11-12): a first-time visitor with no
  // persisted language still gets their browser language on the
  // server render, from Accept-Language, so the first paint is not
  // English-by-default. Persisted cookie still wins over the browser.
  const acceptLanguage = (await headers()).get("accept-language");
  const browserLocale = acceptLanguage
    ? acceptLanguage.split(",")[0]?.trim() || null
    : null;
  return resolveRoamlyLocale({
    persistedLocale: cookieStore.get(ROAMLY_LOCALE_COOKIE)?.value,
    browserLocale
  });
}

export function getRequestLocale(request: NextRequest, language?: string | null): RoamlyLocale {
  return resolveRoamlyLocale({
    explicitLocale: language,
    persistedLocale: request.cookies.get(ROAMLY_LOCALE_COOKIE)?.value
  });
}

export function resolveBackgroundLocale(input: {
  locale?: string | null;
  persistedLocale?: string | null;
  fallback?: string | null;
} = {}): RoamlyLocale {
  return resolveRoamlyLocale({
    explicitLocale: input.locale,
    persistedLocale: input.persistedLocale,
    storedLocale: input.fallback || ROAMLY_DEFAULT_LOCALE
  });
}
