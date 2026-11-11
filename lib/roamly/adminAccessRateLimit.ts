import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Shared-store backing for the admin door's brute-force lockout
 * (Stage 5, 2026-11-11).
 *
 * The door (app/api/admin/access/route.ts) has always kept its 5-fail /
 * 15-minute lockout in a per-instance Map, and its own comment named
 * the gap: serverless instances do not share that memory, so a
 * distributed guessing spread across instances was not fully stopped.
 * This module is the shared layer, built on the tree's proven quota
 * shape (lib/roamly/emailSendQuota.ts + migration 20261106000200):
 * pseudonymous HMAC actor hashes (no raw IP is ever stored), a table
 * locked to the service role, and RPCs callable only by the service
 * role (migration 20261111000200 §1).
 *
 * Degradation contract: every function here returns a value and never
 * throws. When the store is unreachable or unconfigured the caller
 * falls back to the in-memory limiter alone — exactly the pre-Stage-5
 * posture, never weaker, and a database outage can never lock the
 * owner out of his own recovery door.
 */

export type AdminAccessLockout =
  | { ok: true; locked: boolean; retryAfterSeconds: number }
  | { ok: false };

export type AdminAccessFailureRecord =
  | { ok: true; fails: number; locked: boolean; retryAfterSeconds: number }
  | { ok: false };

export function adminAccessActorHash(ip: string, secret: string | undefined) {
  if (!isIP(ip) || !secret || secret.length < 32) return null;
  return createHmac("sha256", secret).update(`roamly-admin-access-rate-v1:${ip}`).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) ? record(data[0]) : record(data);
}

export async function getAdminAccessLockout(
  admin: SupabaseClient,
  actorHash: string
): Promise<AdminAccessLockout> {
  if (!/^[a-f0-9]{64}$/.test(actorHash)) return { ok: false };
  const { data, error } = await admin.rpc("roamly_admin_access_lockout", { p_actor_hash: actorHash });
  if (error) return { ok: false };
  const row = firstRow(data);
  if (!row || typeof row.locked !== "boolean") return { ok: false };
  const retryAfterSeconds = nonnegativeInteger(row.retry_after_seconds);
  if (retryAfterSeconds === null) return { ok: false };
  return { ok: true, locked: row.locked, retryAfterSeconds };
}

export async function recordAdminAccessFailure(
  admin: SupabaseClient,
  actorHash: string,
  maxAttempts: number,
  lockoutSeconds: number
): Promise<AdminAccessFailureRecord> {
  if (!/^[a-f0-9]{64}$/.test(actorHash)) return { ok: false };
  const { data, error } = await admin.rpc("roamly_record_admin_access_failure", {
    p_actor_hash: actorHash,
    p_max_attempts: maxAttempts,
    p_lockout_seconds: lockoutSeconds
  });
  if (error) return { ok: false };
  const row = firstRow(data);
  if (!row || typeof row.locked !== "boolean") return { ok: false };
  const fails = nonnegativeInteger(row.fails);
  const retryAfterSeconds = nonnegativeInteger(row.retry_after_seconds);
  if (fails === null || retryAfterSeconds === null) return { ok: false };
  return { ok: true, fails, locked: row.locked, retryAfterSeconds };
}

export async function clearAdminAccessFailures(
  admin: SupabaseClient,
  actorHash: string
): Promise<{ ok: boolean }> {
  if (!/^[a-f0-9]{64}$/.test(actorHash)) return { ok: false };
  const { error } = await admin.rpc("roamly_clear_admin_access_failures", { p_actor_hash: actorHash });
  return { ok: !error };
}
