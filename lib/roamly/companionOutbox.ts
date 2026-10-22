/*
 * Build 2 Live Companion — the durable Sophie escalation outbox
 * (DESIGN-PRODUCTION.md Phase 7; replaces the shadow sophie.mjs
 * module-global array, which lost every escalation on restart).
 *
 * DORMANT BY CONSTRUCTION. Sophie is not live yet (she lands on the
 * Dell; activation is DESIGN §9's later phase), so this module has
 * NO transport, NO sender, and NO consumer: escalations are recorded
 * durably with ownership + status and wait. Nothing here sends
 * anywhere — the only way out of this outbox is the future Sophie
 * consumption seam listing queued records.
 *
 * Three escalation seats (owner authorization 2026-10-21 15:31 ADT):
 *  - "unresolved-understanding": the deterministic understanding
 *    layer reached the edge of its rules (the Phase 2 engine's
 *    UnresolvedSink plugs in here — see createUnresolvedOutboxSink);
 *  - "impact-weighing": a travel-day impact judgment beyond the
 *    deterministic rules;
 *  - "proposal-review": a repair proposal whose contract holds but
 *    whose judgment call is Sophie's seat (the shadow stand-in's
 *    reviewProposalContract shape).
 *
 * Every record is labeled standIn: true — a deterministic filing,
 * never Sophie's judgment — until she consumes it.
 */

import { contentId } from "./engine/ids";
import type { UnresolvedSink } from "./engine/understand";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SOPHIE_OUTBOX_TABLE = "roamly_sophie_outbox";

export type SophieOutboxKind =
  | "unresolved-understanding"
  | "impact-weighing"
  | "proposal-review";

export const SOPHIE_OUTBOX_KINDS: readonly SophieOutboxKind[] = [
  "unresolved-understanding",
  "impact-weighing",
  "proposal-review"
];

export type SophieOutboxStatus = "queued" | "consumed" | "dismissed";

export interface SophieOutboxRecord {
  outboxId: string; // content ID — re-filing the same escalation dedupes
  userId: string;
  tripId: string | null;
  kind: SophieOutboxKind;
  summary: string;
  context: Record<string, unknown>;
  status: SophieOutboxStatus;
  standIn: true;
  createdAt: string;
}

export interface SophieOutboxStore {
  enqueue(record: SophieOutboxRecord): Promise<{ inserted: boolean }>;
  listQueued(filter: { userId?: string; tripId?: string }): Promise<SophieOutboxRecord[]>;
}

interface OutboxRow {
  outbox_id: string;
  user_id: string;
  trip_id: string | null;
  kind: SophieOutboxKind;
  summary: string;
  context: Record<string, unknown>;
  status: SophieOutboxStatus;
  created_at: string;
}

function rowFromRecord(record: SophieOutboxRecord): OutboxRow {
  return {
    outbox_id: record.outboxId,
    user_id: record.userId,
    trip_id: record.tripId,
    kind: record.kind,
    summary: record.summary,
    context: record.context,
    status: record.status,
    created_at: record.createdAt
  };
}

function recordFromRow(row: OutboxRow): SophieOutboxRecord {
  return {
    outboxId: row.outbox_id,
    userId: row.user_id,
    tripId: row.trip_id,
    kind: row.kind,
    summary: row.summary,
    context: row.context || {},
    status: row.status,
    standIn: true,
    createdAt: row.created_at
  };
}

function isMissingOutboxTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      /relation .* does not exist/i.test(candidate.message))
  );
}

export class SupabaseSophieOutboxStore implements SophieOutboxStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async enqueue(record: SophieOutboxRecord): Promise<{ inserted: boolean }> {
    const { data, error } = await this.supabase
      .from(SOPHIE_OUTBOX_TABLE)
      .upsert(rowFromRecord(record), { onConflict: "outbox_id", ignoreDuplicates: true })
      .select("outbox_id");
    if (error) throw error;
    return { inserted: Array.isArray(data) && data.length > 0 };
  }

  async listQueued(filter: { userId?: string; tripId?: string }): Promise<SophieOutboxRecord[]> {
    let query = this.supabase
      .from(SOPHIE_OUTBOX_TABLE)
      .select("outbox_id, user_id, trip_id, kind, summary, context, status, created_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true });
    if (filter.userId) query = query.eq("user_id", filter.userId);
    if (filter.tripId) query = query.eq("trip_id", filter.tripId);
    const { data, error } = await query;
    if (error) {
      if (isMissingOutboxTableError(error)) return [];
      throw error;
    }
    return (data || []).map((row) => recordFromRow(row as OutboxRow));
  }
}

export class InMemorySophieOutboxStore implements SophieOutboxStore {
  private readonly rows = new Map<string, SophieOutboxRecord>();

  async enqueue(record: SophieOutboxRecord): Promise<{ inserted: boolean }> {
    if (this.rows.has(record.outboxId)) return { inserted: false };
    this.rows.set(record.outboxId, record);
    return { inserted: true };
  }

  async listQueued(filter: { userId?: string; tripId?: string }): Promise<SophieOutboxRecord[]> {
    return [...this.rows.values()].filter(
      (record) =>
        record.status === "queued" &&
        (!filter.userId || record.userId === filter.userId) &&
        (!filter.tripId || record.tripId === filter.tripId)
    );
  }
}

export interface EnqueueEscalationResult {
  ok: boolean;
  inserted: boolean;
  record: SophieOutboxRecord | null;
  error: string | null;
}

/** File one escalation. This is the ONLY write path — there is no
 *  send path anywhere in this module (dormancy by construction). */
export async function enqueueSophieEscalation(
  store: SophieOutboxStore,
  params: {
    userId: string;
    tripId?: string | null;
    kind: SophieOutboxKind;
    summary: string;
    context?: Record<string, unknown>;
    at?: string;
  }
): Promise<EnqueueEscalationResult> {
  const summary = (params.summary || "").trim();
  if (!params.userId || !summary || !SOPHIE_OUTBOX_KINDS.includes(params.kind)) {
    return { ok: false, inserted: false, record: null, error: "invalid escalation" };
  }
  const record: SophieOutboxRecord = {
    outboxId: contentId("sophie-outbox", [
      params.userId,
      params.tripId || "",
      params.kind,
      summary
    ]),
    userId: params.userId,
    tripId: params.tripId ?? null,
    kind: params.kind,
    summary,
    context: params.context || {},
    status: "queued",
    standIn: true,
    createdAt: params.at || new Date().toISOString()
  };
  try {
    const { inserted } = await store.enqueue(record);
    return { ok: true, inserted, record, error: null };
  } catch (error) {
    return {
      ok: false,
      inserted: false,
      record: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Adapter for the Phase 2 understanding layer: engine/understand.ts
 * reports unresolved cases through an injected UnresolvedSink
 * ({kind, detail} — synchronous, fire-and-forget by design). This
 * sink persists them into the durable outbox as
 * "unresolved-understanding" records; flush() settles the tracked
 * writes so tests and request handlers can observe failures.
 */
export function createUnresolvedOutboxSink(
  store: SophieOutboxStore,
  scope: { userId: string; tripId?: string | null }
): { sink: UnresolvedSink; flush: () => Promise<{ recorded: number; errors: string[] }> } {
  const pending: Promise<EnqueueEscalationResult>[] = [];
  const sink: UnresolvedSink = {
    record(entry: { kind: string; detail: string }) {
      pending.push(
        enqueueSophieEscalation(store, {
          userId: scope.userId,
          tripId: scope.tripId ?? null,
          kind: "unresolved-understanding",
          summary: entry.detail,
          context: { understandKind: entry.kind }
        })
      );
    }
  };
  return {
    sink,
    async flush() {
      const results = await Promise.all(pending.splice(0));
      return {
        recorded: results.filter((result) => result.ok).length,
        errors: results
          .filter((result) => !result.ok)
          .map((result) => result.error || "unknown outbox error")
      };
    }
  };
}
