import { normalizeLocale, type RoamlyLocale } from "@/lib/i18n";

/**
 * Free translation via LibreTranslate (self-hosted, AGPL, Argos Translate engine).
 *
 * Roamly deliberately has no paid translation provider. The engine lives outside
 * the app: point LIBRETRANSLATE_URL at a self-hosted LibreTranslate server
 * (Docker one-liner, see .env.example). When the URL is not set, translation
 * fails honestly with TRANSLATION_NOT_CONFIGURED instead of silently falling
 * back to a paid service. LibreTranslate's hosted instance (libretranslate.com)
 * requires a portal API key; pass it with LIBRETRANSLATE_API_KEY when the
 * configured server needs one.
 */

export class LibreTranslateError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "LibreTranslateError";
    this.code = code;
    this.status = status;
  }
}

export type LibreTranslateConfig = {
  url?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export const LIBRETRANSLATE_DEFAULT_TIMEOUT_MS = 30_000;

export function getLibreTranslateConfig(): LibreTranslateConfig {
  return {
    url: (process.env.LIBRETRANSLATE_URL || "").trim() || undefined,
    apiKey: (process.env.LIBRETRANSLATE_API_KEY || "").trim() || undefined,
    timeoutMs: LIBRETRANSLATE_DEFAULT_TIMEOUT_MS
  };
}

/**
 * LibreTranslate/Argos language code for a Roamly locale. Argos uses
 * "zh-Hans" for Simplified Chinese; every other Roamly locale maps
 * to its own two-letter code.
 */
export function libreTranslateCode(locale: RoamlyLocale): string {
  const code = normalizeLocale(locale);
  if (code === "zh") return "zh-Hans";
  return code;
}

/**
 * Translate a batch of texts with LibreTranslate. `texts` and the returned
 * array are in the same order. Empty input returns [] without a request.
 * Throws LibreTranslateError (never returns partial results) so callers can
 * fail honestly instead of showing a half-translated page.
 */
export async function translateLibreTexts(params: {
  texts: string[];
  source: RoamlyLocale;
  target: RoamlyLocale;
  config?: LibreTranslateConfig;
  timeoutMs?: number;
}): Promise<string[]> {
  const config = params.config ?? getLibreTranslateConfig();
  const texts = params.texts;
  if (texts.length === 0) return [];

  if (!config.url) {
    throw new LibreTranslateError(
      "Roamly translation is not configured yet. Set LIBRETRANSLATE_URL to a self-hosted LibreTranslate server.",
      "TRANSLATION_NOT_CONFIGURED",
      503
    );
  }

  const timeoutMs = params.timeoutMs ?? config.timeoutMs ?? LIBRETRANSLATE_DEFAULT_TIMEOUT_MS;
  const body: Record<string, unknown> = {
    q: texts,
    source: libreTranslateCode(params.source),
    target: libreTranslateCode(params.target),
    format: "text"
  };
  if (config.apiKey) body.api_key = config.apiKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.url.replace(/\/$/, "")}/translate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LibreTranslateError(
        "Roamly translation timed out. Please try again in a moment.",
        "TRANSLATION_FAILED",
        502
      );
    }
    throw new LibreTranslateError(
      "Roamly could not reach the translation service. Please try again in a moment.",
      "TRANSLATION_UNREACHABLE",
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 400 && /api key/i.test(detail)) {
      throw new LibreTranslateError(
        "Roamly translation needs an API key for this translation server. Set LIBRETRANSLATE_API_KEY.",
        "TRANSLATION_API_KEY_REQUIRED",
        503
      );
    }
    throw new LibreTranslateError(
      "Roamly could not translate this itinerary. Please try again in a moment.",
      "TRANSLATION_FAILED",
      502
    );
  }

  const data = (await response.json().catch(() => null)) as {
    translatedText?: string | string[];
  } | null;
  const out = data?.translatedText;
  const list = Array.isArray(out) ? out : typeof out === "string" ? [out] : null;
  if (!list || list.length !== texts.length) {
    throw new LibreTranslateError(
      "Roamly could not translate this itinerary. Please try again in a moment.",
      "TRANSLATION_FAILED",
      502
    );
  }
  return list;
}
