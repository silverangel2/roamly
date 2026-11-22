// KF-2 #2 claim-poison proof (Tangier 2026-11-22) — the batch claim RPC
// selected TWO rows for one trip and Postgres 23505 aborted the whole
// claim, so every 5-minute wake claimed NOTHING for 2 days.
//
// The poison: Sokoto trip 1edda600 left a failed+FAILED pair (engine job
// 4747105c + brain job 6ad988a9, both failed, retry_count 1, completed_at
// NULL). The 2026-11-12 guard only blocks a failed row while a LIVE sibling
// exists — a failed+failed pair passes on BOTH rows. The single UPDATE to
// status='running' then violates unique index
// roamly_trip_generation_jobs_active_trip_idx and the statement dies.
//
// The fix (supabase/migrations/20261122_roamly_claim_per_trip_dedupe.sql):
// rank the claimable rows per trip with row_number() on the exact claim
// ranking and keep only rank 1 per trip before the LIMIT — covers
// failed+failed and failed x N. (A waiting+waiting pair cannot exist:
// the partial unique index forbids two active rows for one trip at write
// time, so no claim-side dedupe could ever see one.)
//
// PROOF STANDARD (Junel 2026-11-20: no weak code): this script must FAIL
// on the unfixed RPC and PASS on the fixed RPC, against a REAL Postgres.
// It seeds the exact poisoned state in a scratch database and calls the
// REAL roamly_claim_generation_jobs — nothing is re-implemented.
//
// REQUIREMENT: a Postgres reachable through the Dell SSH helper
// (~/workspace/dell-ssh/dell_ssh_direct.sh, direct Tailscale SSH to the
// Dell; the scratch DB lives in the roamly-db container and is dropped
// at the end of every run, pass or fail). Override with:
//   KF2_SSH_HELPER — path to the helper script
//   KF2_TEST_DB    — scratch database name (default kf2_claim_poison_test)
// Run: npm run test:kf2-claim-poison
//
// Proof level: claim behavior against real Postgres 17 with the real RPC
// text read from the migration files. NOT proven here: that a live cron
// wake claims a real trip end to end — that is the heal proof (Tangier
// claimed + generated at the 13:30 wake, Nov 22) and the next daily test.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const SSH_HELPER =
  process.env.KF2_SSH_HELPER ||
  path.join(os.homedir(), "workspace/dell-ssh/dell_ssh_direct.sh");
const TEST_DB = process.env.KF2_TEST_DB || "kf2_claim_poison_test";

const NEW_MIGRATION = "supabase/migrations/20261122_roamly_claim_per_trip_dedupe.sql";
const OLD_MIGRATION = "supabase/migrations/20261112_roamly_claim_skip_superseded_failed.sql";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_A = "aaaaaaaa-0000-4000-8000-000000000001"; // failed+failed pair
const TRIP_B = "aaaaaaaa-0000-4000-8000-000000000002"; // failed x 3 (repeat retries)
const TRIP_C = "aaaaaaaa-0000-4000-8000-000000000003"; // single waiting job (control)
const JOB_A1 = "a0000001-0000-4000-8000-000000000001"; // earlier created -> must win
const JOB_A2 = "a0000002-0000-4000-8000-000000000002";
const JOB_B1 = "b0000001-0000-4000-8000-000000000001"; // earlier created -> must win
const JOB_B2 = "b0000002-0000-4000-8000-000000000002";
const JOB_B3 = "b0000003-0000-4000-8000-000000000003";
const JOB_C1 = "c0000001-0000-4000-8000-000000000001";

function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Run a command on the Dell through the SSH helper. SQL always travels via
// a temp file redirected into the helper's stdin (a plain shell pipeline) —
// piping through Node's execFile input broke the SSH channel once with
// "client_loop: send disconnect: Broken pipe", while the shell pipeline
// proved reliable for the same bytes.
function runRemote(remoteCmd, stdinFile = null) {
  const pipeline = stdinFile
    ? `bash ${shq(SSH_HELPER)} ${shq(remoteCmd)} < ${shq(stdinFile)}`
    : `bash ${shq(SSH_HELPER)} ${shq(remoteCmd)}`;
  return new Promise((resolve, reject) => {
    execFile("bash", ["-c", pipeline], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

const psqlCmd = (db) =>
  `wsl -d Ubuntu docker exec -i roamly-db psql -U supabase_admin -d ${db} -v ON_ERROR_STOP=1 -t -A`;
const createdbCmd = `wsl -d Ubuntu docker exec roamly-db createdb -U supabase_admin ${TEST_DB}`;
const dropdbCmd = `wsl -d Ubuntu docker exec roamly-db dropdb -U supabase_admin --if-exists ${TEST_DB}`;

async function psql(db, sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kf2-psql-"));
  const file = path.join(dir, "input.sql");
  try {
    fs.writeFileSync(file, sql);
    const { stdout, stderr } = await runRemote(psqlCmd(db), file);
    if (stderr.trim()) process.stderr.write(`[psql ${db}] ${stderr}`);
    return stdout;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SCHEMA_SQL = `
create table public.roamly_trips (
  id uuid primary key,
  user_id uuid,
  status text,
  itinerary_status text
);
create table public.roamly_trip_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid,
  user_id uuid,
  status text,
  retry_count integer not null default 0,
  priority integer not null default 0,
  next_attempt_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index roamly_trip_generation_jobs_active_trip_idx
  on public.roamly_trip_generation_jobs (trip_id)
  where status in ('queued', 'running', 'waiting');
`;

const SEED_SQL = `
insert into public.roamly_trips (id, user_id, status, itinerary_status) values
  ('${TRIP_A}', '${USER_ID}', 'active', 'generating'),
  ('${TRIP_B}', '${USER_ID}', 'active', 'generating'),
  ('${TRIP_C}', '${USER_ID}', 'active', 'generating');
insert into public.roamly_trip_generation_jobs
  (id, trip_id, user_id, status, retry_count, priority, next_attempt_at, completed_at, created_at) values
  ('${JOB_A1}', '${TRIP_A}', '${USER_ID}', 'failed', 1, 0, now() - interval '1 day', null, now() - interval '2 days'),
  ('${JOB_A2}', '${TRIP_A}', '${USER_ID}', 'failed', 1, 0, now() - interval '1 day', null, now() - interval '2 days' + interval '1 hour'),
  ('${JOB_B1}', '${TRIP_B}', '${USER_ID}', 'failed', 1, 0, now() - interval '1 day', null, now() - interval '2 days'),
  ('${JOB_B2}', '${TRIP_B}', '${USER_ID}', 'failed', 2, 0, now() - interval '1 day', null, now() - interval '2 days' + interval '1 hour'),
  ('${JOB_B3}', '${TRIP_B}', '${USER_ID}', 'failed', 2, 0, now() - interval '1 day', null, now() - interval '2 days' + interval '2 hours'),
  ('${JOB_C1}', '${TRIP_C}', '${USER_ID}', 'waiting', 0, 0, now() - interval '1 hour', null, now() - interval '2 days');
`;

const CLAIM_SQL = `select id, trip_id, status from public.roamly_claim_generation_jobs('kf2-test-worker', 5);`;
const RUNNING_SQL = `select trip_id, count(*) from public.roamly_trip_generation_jobs where status = 'running' group by trip_id order by trip_id;`;
const SIBLINGS_SQL = `select id, status from public.roamly_trip_generation_jobs where id in ('${JOB_A2}', '${JOB_B2}', '${JOB_B3}') order by id;`;

async function freshDb() {
  await runRemote(dropdbCmd);
  await runRemote(createdbCmd);
  await psql(TEST_DB, SCHEMA_SQL);
}

function parseClaimRows(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, tripId, status] = line.split("|");
      return { id, tripId, status };
    });
}

async function main() {
  // ---- source contract: the fix must be the per-trip dedupe, and the old
  // file must still be the unfixed version (otherwise the negative control
  // below proves nothing) ----
  const fixedSql = read(NEW_MIGRATION);
  assert.match(fixedSql, /row_number\(\) over \(\s*partition by j\.trip_id/s, "fixed RPC must rank rows per trip");
  assert.match(fixedSql, /trip_rank = 1/, "fixed RPC must keep only rank 1 per trip");
  assert.match(fixedSql, /for update of j skip locked/, "fixed RPC must still lock the base-table rows");
  const oldSql = read(OLD_MIGRATION);
  assert.doesNotMatch(oldSql, /trip_rank/, "old RPC must not contain the dedupe (negative control guard)");
  console.log("PASS source contract: new migration dedupes per trip; old migration is the unfixed version");

  try {
    // ---- fixed RPC: the poisoned seed must claim exactly one row per trip ----
    await freshDb();
    await psql(TEST_DB, fixedSql);
    await psql(TEST_DB, SEED_SQL);
    const claimedOut = await psql(TEST_DB, CLAIM_SQL);
    const claimed = parseClaimRows(claimedOut);
    assert.equal(claimed.length, 3, `fixed RPC must claim 3 rows (one per trip), got ${claimed.length}: ${claimedOut}`);
    const byTrip = new Map(claimed.map((row) => [row.tripId, row]));
    assert.equal(byTrip.get(TRIP_A)?.id, JOB_A1, "failed+failed pair: the earlier-created failed row must win");
    assert.equal(byTrip.get(TRIP_B)?.id, JOB_B1, "failed x 3: the earlier-created failed row must win");
    assert.equal(byTrip.get(TRIP_C)?.id, JOB_C1, "single waiting job must claim");
    assert.ok(claimed.every((row) => row.status === "running"), "every claimed row must be running");
    const runningOut = await psql(TEST_DB, RUNNING_SQL);
    const runningLines = runningOut.trim().split("\n").filter(Boolean);
    assert.equal(runningLines.length, 3, `exactly one running row per trip in the table, got: ${runningOut}`);
    assert.ok(runningLines.every((line) => line.endsWith("|1")), `each trip must have exactly 1 running row, got: ${runningOut}`);
    const siblingsOut = await psql(TEST_DB, SIBLINGS_SQL);
    assert.match(siblingsOut, new RegExp(`${JOB_A2}\\|failed`), "losing failed sibling must stay failed");
    assert.match(siblingsOut, new RegExp(`${JOB_B2}\\|failed`), "losing failed sibling must stay failed");
    assert.match(siblingsOut, new RegExp(`${JOB_B3}\\|failed`), "losing failed sibling must stay failed");
    console.log("PASS fixed RPC: 3 rows claimed (one per trip), no 23505, losers untouched");

    // ---- negative control: the unfixed RPC must throw 23505 on the same seed ----
    await freshDb();
    await psql(TEST_DB, oldSql);
    await psql(TEST_DB, SEED_SQL);
    let threw = null;
    try {
      await psql(TEST_DB, CLAIM_SQL);
    } catch (error) {
      threw = error;
    }
    assert.ok(threw, "unfixed RPC must fail on the poisoned seed (negative control)");
    const combined = `${threw.stderr || ""}\n${threw.stdout || ""}`;
    // psql prints the violation as text, not the numeric SQLSTATE: the
    // 23505 unique_violation surfaces as "duplicate key value violates
    // unique constraint <index name>".
    assert.match(
      combined,
      /duplicate key value violates unique constraint "roamly_trip_generation_jobs_active_trip_idx"/,
      `unfixed RPC must fail with a 23505 unique violation, got: ${combined.slice(0, 500)}`
    );
    console.log("PASS negative control: unfixed RPC throws 23505 on the same seed");
  } finally {
    await runRemote(dropdbCmd).catch(() => {});
  }

  console.log("PASS kf2-claim-poison: fixed RPC claims one row per trip; unfixed RPC throws 23505");
}

main().catch((error) => {
  console.error(`FAIL kf2-claim-poison: ${error.message}`);
  if (error.stderr) console.error(error.stderr.slice(0, 2000));
  process.exit(1);
});
