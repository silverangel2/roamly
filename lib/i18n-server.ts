import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  ROAMLY_DEFAULT_LOCALE,
  ROAMLY_LOCALE_COOKIE,
  resolveRoamlyLocale,
  type RoamlyLocale
} from "@/lib/i18n";

export async function getServerLocale(): Promise<RoamlyLocale> {
  const cookieStore = await cookies();
  return resolveRoamlyLocale({ persistedLocale: cookieStore.get(ROAMLY_LOCALE_COOKIE)?.value });
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
