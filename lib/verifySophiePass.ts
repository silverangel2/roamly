/**
 * Sophie Command Door — CRYPTOGRAM PASS verification (2026-10-22).
 *
 * The signed one-time pass that replaces the permanent shared door
 * password as Sophie's primary identity:
 *
 *   - Sophie signs every knock with her Ed25519 PRIVATE key, which lives
 *     only on Junel's iMac. The door holds just the PUBLIC key in the
 *     SOPHIE_PUBLIC_KEY env var (set by Junel in Vercel). A public key
 *     can verify her seal but can never fake it — there is no password
 *     worth stealing on this side anymore.
 *   - The signed payload is exactly:
 *         "sophie-pass-v1\n<site>\n<unix-ts>\n<nonce>"
 *     sent as headers X-Sophie-Site / X-Sophie-Ts / X-Sophie-Nonce /
 *     X-Sophie-Sig (base64 signature).
 *   - A pass is accepted only when ALL of these hold: the signature is
 *     valid for the configured public key; the site matches this door;
 *     the timestamp is within ±120 seconds of the door's clock; and the
 *     nonce has never been accepted before (short-lived replay cache).
 *     A pass is born per knock, used once, and worthless after.
 *
 * Transition safety lives in the caller (sophieAuthError in
 * lib/sophieCommand.ts): when a pass verifies, the knock is authorized;
 * otherwise the door falls back to the legacy SOPHIE_COMMAND_KEY check,
 * so nothing breaks during switch-over. Deleting SOPHIE_COMMAND_KEY
 * from the env at cutover retires the old password completely.
 *
 * Honest limit: the replay cache is in-memory, per server instance. On
 * serverless hosting a cold-started instance starts with an empty cache,
 * so replay protection there is best-effort inside the ±120-second
 * window — the short window is the hard bound either way.
 *
 * Built-in `crypto` only — no new dependencies. Never throws; the
 * verdict is a value, in the door module's house style.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from "crypto";

export const SOPHIE_PASS_WINDOW_SECONDS = 120;

const PASS_VERSION = "sophie-pass-v1";
const REPLAY_CACHE_MAX = 5000;
// DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type SophiePassVerdict =
  | { ok: true }
  | { ok: false; attempted: boolean; error: string };

export type SophiePassHeaders = {
  get(name: string): string | null;
};

export type SophiePassOptions = {
  /** Raw public key material; defaults to process.env.SOPHIE_PUBLIC_KEY. */
  publicKey?: string;
  /** Door clock override (unix seconds) — tests only. */
  nowSeconds?: number;
};

/** nonce -> expiry (unix seconds). Module state: the replay cache. */
const seenNonces = new Map<string, number>();

let cachedKeySource: string | null = null;
let cachedKey: KeyObject | null = null;

function loadPublicKey(material: string): KeyObject | null {
  if (cachedKey && cachedKeySource === material) return cachedKey;
  try {
    let key: KeyObject;
    const trimmed = material.trim();
    if (trimmed.includes("BEGIN")) {
      key = createPublicKey(trimmed);
    } else {
      const raw = Buffer.from(trimmed, "base64");
      if (raw.length === 32) {
        key = createPublicKey({
          key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
          format: "der",
          type: "spki",
        });
      } else {
        key = createPublicKey({ key: raw, format: "der", type: "spki" });
      }
    }
    cachedKeySource = material;
    cachedKey = key;
    return key;
  } catch {
    return null;
  }
}

function pruneReplayCache(now: number): void {
  for (const [nonce, expiry] of seenNonces) {
    if (expiry < now) seenNonces.delete(nonce);
  }
  while (seenNonces.size > REPLAY_CACHE_MAX) {
    const oldest = seenNonces.keys().next().value;
    if (oldest === undefined) break;
    seenNonces.delete(oldest);
  }
}

/**
 * Verify a cryptogram pass. `attempted` reports whether any pass header
 * was presented at all, so the caller can tell "she knocked the old way"
 * (fall back to the legacy key) from "her pass failed" (surface why).
 */
export function verifySophiePass(
  headers: SophiePassHeaders,
  expectedSite: string,
  options: SophiePassOptions = {}
): SophiePassVerdict {
  const site = headers.get("x-sophie-site");
  const ts = headers.get("x-sophie-ts");
  const nonce = headers.get("x-sophie-nonce");
  const sig = headers.get("x-sophie-sig");
  if (!site && !ts && !nonce && !sig) {
    return { ok: false, attempted: false, error: "No Sophie pass presented." };
  }
  if (!site || !ts || !nonce || !sig) {
    return { ok: false, attempted: true, error: "Malformed Sophie pass." };
  }
  const material =
    options.publicKey ?? process.env.SOPHIE_PUBLIC_KEY ?? "";
  if (!material.trim()) {
    return {
      ok: false,
      attempted: true,
      error: "Sophie pass is not configured.",
    };
  }
  const key = loadPublicKey(material);
  if (!key) {
    return {
      ok: false,
      attempted: true,
      error: "Sophie pass is not configured.",
    };
  }
  if (site !== expectedSite) {
    return {
      ok: false,
      attempted: true,
      error: "Sophie pass was issued for a different site.",
    };
  }
  if (!/^\d{9,12}$/.test(ts) || nonce.length < 8 || nonce.length > 128) {
    return { ok: false, attempted: true, error: "Malformed Sophie pass." };
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tsNum = Number(ts);
  if (Math.abs(now - tsNum) > SOPHIE_PASS_WINDOW_SECONDS) {
    return { ok: false, attempted: true, error: "Sophie pass expired." };
  }
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(sig, "base64");
  } catch {
    return { ok: false, attempted: true, error: "Malformed Sophie pass." };
  }
  if (sigBytes.length !== 64) {
    return { ok: false, attempted: true, error: "Malformed Sophie pass." };
  }
  const payload = Buffer.from(
    `${PASS_VERSION}\n${site}\n${ts}\n${nonce}`,
    "utf-8"
  );
  let valid = false;
  try {
    valid = cryptoVerify(null, payload, key, sigBytes);
  } catch {
    valid = false;
  }
  if (!valid) {
    return {
      ok: false,
      attempted: true,
      error: "Unauthorized command request.",
    };
  }
  // Signature is genuine — only now does the nonce enter the cache, so a
  // forged knock can never burn one of her nonces.
  pruneReplayCache(now);
  if (seenNonces.has(nonce)) {
    return {
      ok: false,
      attempted: true,
      error: "Sophie pass already used.",
    };
  }
  seenNonces.set(nonce, tsNum + SOPHIE_PASS_WINDOW_SECONDS);
  return { ok: true };
}

/** Test/diagnostic helper: forget every seen nonce. */
export function resetSophiePassReplayCache(): void {
  seenNonces.clear();
}
