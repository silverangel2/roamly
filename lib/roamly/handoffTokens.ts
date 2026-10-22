/*
 * Desktop→phone handoff passes (DESIGN-PRODUCTION.md §2.4, Phase 6;
 * owner ruling 2026-10-21 19:15 ADT: "How can this be moved on phone?
 * through QR code?").
 *
 * The pass is a signed, 10-minute, SINGLE-USE token bound to the
 * account + trip. Only its SHA-256 hash is stored (M6,
 * roamly_handoff_tokens) — the stateless precedents in this codebase
 * (dailyTestClaim.ts, bookingEvidenceToken.ts) cannot burn a token;
 * M6's server state is what makes single-use true. Redemption burns
 * atomically: one conditional UPDATE that matches only an unused,
 * unexpired row.
 *
 * Token format: v1.<rand>.<sig>
 *   rand = 32 random bytes, base64url (the stored hash is sha256(rand))
 *   sig  = HMAC-SHA256(ROAMLY_HANDOFF_SECRET, "<rand>.<userId>.<tripId>")
 * A tampered signature verifies against the looked-up record and
 * fails WITHOUT burning the pass — the genuine code still works.
 * Expired, used, invalid, and tampered all surface to the traveler as
 * the same plain "ask for a fresh code" state (HANDOFF_UNAVAILABLE_*).
 *
 * ROAMLY_HANDOFF_SECRET is deliberately distinct from
 * ROAMLY_SESSION_TOKEN_SECRET (clean rotation, DESIGN §2.6): with no
 * secret configured the service is unavailable — it never falls back
 * to another secret.
 *
 * A successful redemption also issues the phone-session binding: an
 * HMAC-signed httpOnly cookie carrying (userId, tripId, deviceId), so
 * the phone — even one that was never signed in — is bound to the
 * account + trip for the gate flow. It is a device-attested binding
 * for that one trip, not a general account session.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isHandoffTokenDTO,
  type HandoffTokenDTO
} from "@/lib/roamly/engine/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";

export const HANDOFF_TOKENS_TABLE = "roamly_handoff_tokens";
export const HANDOFF_TTL_MS = 10 * 60 * 1000;
export const HANDOFF_COOKIE_NAME = "roamly_handoff_session";
export const HANDOFF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const HANDOFF_UNAVAILABLE_ERROR = "HANDOFF_CODE_UNAVAILABLE";
export const HANDOFF_UNAVAILABLE_MESSAGE =
  "This code has been used or has expired. Open Roamly on your computer and choose “Take this trip with you” to get a fresh code.";

type EnvLike = Record<string, string | undefined>;

export function handoffSecret(env: EnvLike = process.env): string {
  return (env.ROAMLY_HANDOFF_SECRET || "").trim();
}

export function handoffConfigured(env: EnvLike = process.env): boolean {
  return handoffSecret(env).length > 0;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ */
/* Store seam                                                          */
/* ------------------------------------------------------------------ */

export interface HandoffStore {
  insert(record: HandoffTokenDTO): Promise<void>;
  findByHash(tokenHash: string): Promise<HandoffTokenDTO | null>;
  /**
   * Atomically burn: set used_at only where the row is still unused
   * and unexpired. Returns true when THIS call burned the token.
   */
  burn(tokenId: string, usedAt: UtcInstant): Promise<boolean>;
}

interface HandoffTokenRow {
  token_id: string;
  user_id: string;
  trip_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

function rowToDTO(row: HandoffTokenRow): HandoffTokenDTO {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    tripId: row.trip_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at as UtcInstant,
    expiresAt: row.expires_at as UtcInstant,
    usedAt: row.used_at as UtcInstant | null
  };
}

export function createSupabaseHandoffStore(supabase: SupabaseClient): HandoffStore {
  return {
    async insert(record) {
      const { error } = await supabase.from(HANDOFF_TOKENS_TABLE).insert({
        token_id: record.tokenId,
        user_id: record.userId,
        trip_id: record.tripId,
        token_hash: record.tokenHash,
        created_at: record.createdAt,
        expires_at: record.expiresAt,
        used_at: record.usedAt
      });
      if (error) throw new Error(`handoff token insert failed: ${error.message}`);
    },

    async findByHash(tokenHash) {
      const { data, error } = await supabase
        .from(HANDOFF_TOKENS_TABLE)
        .select("token_id, user_id, trip_id, token_hash, created_at, expires_at, used_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) {
        if (error.code === "42P01" || /relation .* does not exist/i.test(error.message || "")) return null;
        throw new Error(`handoff token lookup failed: ${error.message}`);
      }
      return data ? rowToDTO(data as HandoffTokenRow) : null;
    },

    async burn(tokenId, usedAt) {
      const { data, error } = await supabase
        .from(HANDOFF_TOKENS_TABLE)
        .update({ used_at: usedAt })
        .eq("token_id", tokenId)
        .is("used_at", null)
        .gt("expires_at", usedAt)
        .select("token_id");
      if (error) throw new Error(`handoff token burn failed: ${error.message}`);
      return Array.isArray(data) && data.length === 1;
    }
  };
}

/** Deterministic in-memory store for the check harness. */
export class InMemoryHandoffStore implements HandoffStore {
  private readonly records = new Map<string, HandoffTokenDTO>();

  async insert(record: HandoffTokenDTO): Promise<void> {
    this.records.set(record.tokenHash, { ...record });
  }

  async findByHash(tokenHash: string): Promise<HandoffTokenDTO | null> {
    const record = this.records.get(tokenHash);
    return record ? { ...record } : null;
  }

  async burn(tokenId: string, usedAt: UtcInstant): Promise<boolean> {
    for (const record of this.records.values()) {
      if (record.tokenId !== tokenId) continue;
      if (record.usedAt !== null) return false;
      if (Date.parse(record.expiresAt) <= Date.parse(usedAt)) return false;
      record.usedAt = usedAt;
      return true;
    }
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Mint / redeem                                                       */
/* ------------------------------------------------------------------ */

export interface MintedHandoffPass {
  token: string;
  url: string;
  record: HandoffTokenDTO;
}

export async function mintHandoffPass(
  store: HandoffStore,
  params: {
    userId: string;
    tripId: string;
    origin: string;
    now: UtcInstant;
    env?: EnvLike;
  }
): Promise<MintedHandoffPass> {
  const secret = handoffSecret(params.env);
  if (!secret) throw new Error("HANDOFF_NOT_CONFIGURED");
  const rand = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(rand);
  const signature = sign(`${rand}.${params.userId}.${params.tripId}`, secret);
  const createdAt = params.now;
  const expiresAt = new Date(Date.parse(createdAt) + HANDOFF_TTL_MS).toISOString() as UtcInstant;
  const record: HandoffTokenDTO = {
    tokenId: `handoff_${randomBytes(16).toString("hex")}`,
    userId: params.userId,
    tripId: params.tripId,
    tokenHash,
    createdAt,
    expiresAt,
    usedAt: null
  };
  if (!isHandoffTokenDTO(record)) throw new Error("handoff record failed DTO validation");
  await store.insert(record);
  const token = `v1.${rand}.${signature}`;
  const origin = params.origin.replace(/\/+$/, "");
  return { token, url: `${origin}/handoff/${token}`, record };
}

export type HandoffRedeemFailureReason = "invalid" | "tampered" | "expired" | "used" | "unconfigured";

export type HandoffRedeemResult =
  | { ok: true; userId: string; tripId: string; tokenId: string }
  | { ok: false; reason: HandoffRedeemFailureReason };

function parseToken(token: string): { rand: string; signature: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;
  return { rand: parts[1], signature: parts[2] };
}

/**
 * Redeem a pass: verifies shape, record, signature, expiry — then
 * burns atomically. Every failure is a distinct internal reason for
 * tests and logs; the API surface collapses them all into the one
 * plain fresh-code state.
 */
export async function redeemHandoffPass(
  store: HandoffStore,
  params: { token: string; now: UtcInstant; env?: EnvLike }
): Promise<HandoffRedeemResult> {
  const secret = handoffSecret(params.env);
  if (!secret) return { ok: false, reason: "unconfigured" };
  const parsed = parseToken((params.token || "").trim());
  if (!parsed) return { ok: false, reason: "invalid" };

  const record = await store.findByHash(sha256Hex(parsed.rand));
  if (!record) return { ok: false, reason: "invalid" };

  const expectedSignature = sign(`${parsed.rand}.${record.userId}.${record.tripId}`, secret);
  if (!timingSafeStringEqual(parsed.signature, expectedSignature)) {
    // Tampered: refused WITHOUT burning — the genuine pass still works.
    return { ok: false, reason: "tampered" };
  }
  if (record.usedAt !== null) return { ok: false, reason: "used" };
  if (Date.parse(record.expiresAt) <= Date.parse(params.now)) return { ok: false, reason: "expired" };

  const burned = await store.burn(record.tokenId, params.now);
  if (!burned) return { ok: false, reason: "used" }; // lost a race — someone redeemed first
  return { ok: true, userId: record.userId, tripId: record.tripId, tokenId: record.tokenId };
}

/* ------------------------------------------------------------------ */
/* Phone-session binding cookie                                        */
/* ------------------------------------------------------------------ */

export interface HandoffSessionBinding {
  userId: string;
  tripId: string;
  deviceId: string;
}

export function createHandoffSessionCookieValue(
  binding: HandoffSessionBinding,
  params: { now: UtcInstant; env?: EnvLike }
): string | null {
  const secret = handoffSecret(params.env);
  if (!secret) return null;
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      userId: binding.userId,
      tripId: binding.tripId,
      deviceId: binding.deviceId,
      exp: Date.parse(params.now) + HANDOFF_COOKIE_MAX_AGE_SECONDS * 1000
    }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sign(`session.${payload}`, secret)}`;
}

export function verifyHandoffSessionCookie(
  value: string | null | undefined,
  params: { now: UtcInstant; env?: EnvLike }
): HandoffSessionBinding | null {
  const secret = handoffSecret(params.env);
  if (!secret || !value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  if (!timingSafeStringEqual(signature, sign(`session.${payload}`, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: number;
      userId?: string;
      tripId?: string;
      deviceId?: string;
      exp?: number;
    };
    if (
      parsed.v !== 1 ||
      typeof parsed.userId !== "string" ||
      typeof parsed.tripId !== "string" ||
      typeof parsed.deviceId !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Date.parse(params.now)
    ) {
      return null;
    }
    return { userId: parsed.userId, tripId: parsed.tripId, deviceId: parsed.deviceId };
  } catch {
    return null;
  }
}
