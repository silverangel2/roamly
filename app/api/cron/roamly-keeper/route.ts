import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import {
  KEEPER_LOCK_NAME,
  KEEPER_RUNNER_PREFIX,
  acquireKeeperLock,
  classifyEmailError,
  logKeeperRun,
  releaseKeeperLock,
  runKeeperSuite,
  type KeeperDeps
} from "@/lib/roamly/roamlyKeeper";
import { recordKeeperFaultMemory } from "@/lib/roamly/keeperFaultMemory";
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
      // EGRESS WART CLOSURE (2026-11-02, EGRESS-DIET-REPORT §2 lane 8):
      // this read used to pull EVERY concierge_suggestions row with 12
      // columns, hourly, with no filter and no limit. Consumer trace:
      // the only consumer is conciergeRowsToSuggestionTally, which
      // (a) ignores every row whose outcome is not "kept"/"dropped"
      // and (b) reads only kind, title, item_ref, pattern_key and
      // outcome (stableSuggestionKey + label + the kept/dropped
      // counts). The query therefore pushes that exact in-memory
      // filter into the read (.in outcome kept/dropped) and projects
      // exactly those five columns — the tally the suite computes is
      // byte-identical. NO limit is added, deliberately: the tally is
      // an all-history cross-trip aggregate and the keeper's retire
      // rule is count-based (>= 5 drops and 0 keeps over ALL decided
      // rows), so any row limit would silently change the counts and
      // could hide or invent retire candidates. Growth risk, named:
      // the DECIDED-row subset still grows unbounded with the table;
      // the correct future bound is a database-side aggregation of
      // this same tally, not a limit on this read.
      const { data, error } = await admin
        .from("concierge_suggestions")
        .select("kind,title,item_ref,pattern_key,outcome")
        .in("outcome", ["kept", "dropped"]);
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
    // FAULT MEMORY (Lift 2, v1): record this run's fault patterns and
    // outcomes into roamly_keeper_fault_memory, beside logKeeperRun.
    // Fail-soft by contract — a memory failure never fails the run, and
    // until the migration is applied by hand every call simply reports
    // tableMissing. The returned report carries the memory counters in
    // its summary, so the ops-ledger attempt and the Sophie World keeper
    // station (sitrep recentRuns) show them; last_job_id inside memory
    // uses the same deterministic `keeper-<runnerId>` id logKeeperRun
    // is about to write.
    const memory = await recordKeeperFaultMemory(admin, report, classifyEmailError);
    const logged = await logKeeperRun(admin, memory.report);
    return NextResponse.json(
      { ok: true, report: memory.report, logged, faultMemory: memory.counters },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    await releaseKeeperLock(admin, runnerId);
  }
}
