import type { RoamlyLocale } from "@/lib/i18n";

export function briefingMessage(
  locale: RoamlyLocale,
  key: string,
  values?: Record<string, string>
): string;

export function localizeActivityNotification(
  locale: RoamlyLocale,
  type: string,
  title: string,
  body: string,
  metadata?: Record<string, unknown>
): { title: string; body: string };
