import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import {
  KEEPER_LOCK_NAME,
  KEEPER_RUNNER_PREFIX,
  acquireKeeperLock,
  logKeeperRun,
  releaseKeeperLock,
  runKeeperSuite,
  type KeeperDeps
} from "@/lib/roamly/roamlyKeeper";
import { conciergeRowsToSuggestionTally } from "@/lib/roamly/concierge/conciergeSuggestionTally";
import type { ConciergeSuggestionRow } from "@/lib/roamly/concierge/conciergeSuggestions";
import { supabaseKeeperDb } from "@/lib/roamly/keeperStore";

/**
 * GET /api/cron/roamly-keeper — runs the Roamly Keeper suite (checks always;
 * repairs only when ROAMLY_KEEPER_REPAIRS=on). Mirrors the repo's cron route
 * conventions (same CRON_SECRET gate as roamly-fyi-digest).
 *
 * Schedule: hourly (vercel.json, "0 * * * *") — decided by Junel 2026-10-16.
 */
export async function GET(request: NextRequest) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return NextResponse.json({ ok: false, error: "Notification cron secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, expected)) return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Supabase admin client is not configured." }, { status: 503 });
  const runnerId = `${KEEPER_RUNNER_PREFIX}.${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
  const locked = await acquireKeeperLock(admin, runnerId);
  if (!locked) {
    return NextResponse.json({ ok: true, skipped: true, reason: "keeper already running", lock: KEEPER_LOCK_NAME }, { status: 200 });
  }
  try {
    const db = supabaseKeeperDb(admin);
    // Concierge keep-rate adapter: the Concierge logs per-trip suggestion rows;
    // the tally shim translates them into the keeper's cross-trip tallies.
    // Fail-soft by design: a missing table or read error leaves suggestions
    // undefined, and the lane reports an honest note — the run never breaks.
    let suggestions: KeeperDeps["suggestions"];
    try {
      const { data, error } = await admin
        .from("concierge_suggestions")
        .select("id,trip_id,user_id,kind,day_number,item_ref,title,reason,pattern_key,pattern_trip_count,applied,outcome");
      if (!error && Array.isArray(data)) {
        suggestions = conciergeRowsToSuggestionTally(data as unknown as ConciergeSuggestionRow[]);
      }
    } catch {
      suggestions = undefined;
    }
    const report = await runKeeperSuite(
      { db, env: process.env as Record<string, string | undefined>, now: () => new Date(), suggestions },
      runnerId
    );
    const logged = await logKeeperRun(admin, report);
    return NextResponse.json({ ok: true, report, logged }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    await releaseKeeperLock(admin, runnerId);
  }
}
