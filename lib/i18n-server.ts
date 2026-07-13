import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { normalizeLocale, type RoamlyLocale } from "@/lib/i18n";

export async function getServerLocale(): Promise<RoamlyLocale> {
  const cookieStore = await cookies();
  return normalizeLocale(cookieStore.get("roamly_lang")?.value);
}

export function getRequestLocale(request: NextRequest, language?: string | null): RoamlyLocale {
  return normalizeLocale(language || request.cookies.get("roamly_lang")?.value || "en");
}
