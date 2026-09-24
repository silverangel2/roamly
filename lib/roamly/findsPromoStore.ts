import { safeExternalUrl } from "@/lib/roamly/bookingLinks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { activeFindsPromo, FINDS_PROMO_SETTING_KEY, type FindsPromoConfig } from "@/lib/roamly/findsCommercialConfig";

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalIso(value: unknown) {
  const candidate = text(value, 40);
  if (!candidate) return undefined;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function normalizeFindsPromoInput(value: unknown): FindsPromoConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const href = safeExternalUrl(text(raw.href, 2000));
  const eyebrow = text(raw.eyebrow, 80);
  const headline = text(raw.headline, 160);
  const description = text(raw.description, 500);
  if (!href || !href.startsWith("https://") || !eyebrow || !headline || !description) return null;
  const startsAt = optionalIso(raw.startsAt);
  const endsAt = optionalIso(raw.endsAt);
  if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) return null;
  return {
    id: text(raw.id, 100) || "admin-finds-promo",
    enabled: raw.enabled !== false,
    type: "tracked_link",
    eyebrow,
    headline,
    description,
    href,
    placement: raw.placement === "secondary" ? "secondary" : "feature",
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {})
  };
}

function isInWindow(promo: FindsPromoConfig, now = new Date()) {
  if (!promo.enabled) return false;
  if (promo.startsAt && now < new Date(promo.startsAt)) return false;
  if (promo.endsAt && now >= new Date(promo.endsAt)) return false;
  return true;
}

export async function getActiveFindsPromo() {
  const admin = createSupabaseAdminClient();
  if (!admin) return activeFindsPromo;
  const { data, error } = await admin.from("roamly_admin_settings").select("value").eq("key", FINDS_PROMO_SETTING_KEY).maybeSingle();
  if (error || !data) return activeFindsPromo;
  const promo = normalizeFindsPromoInput(data.value);
  return promo ? (isInWindow(promo) ? promo : null) : activeFindsPromo;
}

export async function readFindsPromoSetting() {
  const admin = createSupabaseAdminClient();
  if (!admin) return { promo: activeFindsPromo, configured: false };
  const { data, error } = await admin.from("roamly_admin_settings").select("value,updated_at").eq("key", FINDS_PROMO_SETTING_KEY).maybeSingle();
  if (error) return { promo: activeFindsPromo, configured: false, error: error.message };
  const promo = data ? normalizeFindsPromoInput(data.value) : null;
  return { promo: promo || activeFindsPromo, configured: Boolean(promo), updatedAt: data?.updated_at || null };
}

export async function saveFindsPromo(promo: FindsPromoConfig) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, error: "Admin settings are not configured." };
  const { data, error } = await admin.from("roamly_admin_settings").upsert({ key: FINDS_PROMO_SETTING_KEY, value: promo }, { onConflict: "key" }).select("value,updated_at").single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, promo: normalizeFindsPromoInput(data.value) || promo, updatedAt: data.updated_at };
}
