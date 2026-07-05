"use client";

import { useI18n } from "@/components/i18n/I18nProvider";

export function T({ id, fallback = "" }: { id: string; fallback?: string }) {
  const { t } = useI18n();
  return <>{t(id, fallback)}</>;
}
