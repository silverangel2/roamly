// ROAMLY KEEPER v1 tests. Deterministic fixtures; no network, no Supabase.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const overlay = new URL("./overlay/", import.meta.url).pathname;
const jiti = require("/home/hatch/workspace/ri-theme-build/node_modules/jiti")(overlay + "x.js", { alias: { "@": overlay } });
const keeper = jiti("/home/hatch/workspace/roamly-keeper-build/lib/roamly/roamlyKeeper.ts");

// ── Fake KeeperDb ────────────────────────────────────────────────────────────

function makeDb(tables, missing = []) {
  const apply = (rows, filters) =>
    rows.filter((row) =>
      filters.every((f) => {
        const v = row[f.column];
        switch (f.op) {
          case "eq": return v === f.value;
          case "neq": return v !== f.value;
          case "is": return f.value === null ? v == null : v === f.value;
          case "in": return Array.isArray(f.value) && f.value.includes(v);
          case "lt": return typeof v === "number" || typeof v === "string" ? v < f.value : false;
          case "gte": return typeof v === "number" || typeof v === "string" ? v >= f.value : false;
          default: return false;
        }
      })
    );
  const table = (name) => ({
    count: async (filters) => apply(tables[name] || [], filters).length,
    rows: async (filters, opts = {}) => {
      let rows = apply(tables[name] || [], filters).slice();
      if (opts.order && /desc/i.test(opts.order)) {
        const col = opts.order.split(" ")[0];
        rows.sort((a, b) => String(b[col] || "") < String(a[col] || "") ? -1 : 1);
      }
      return rows.slice(0, opts.limit || 500).map((r) => ({ ...r }));
    },
    update: async (patch, filters) => {
      let n = 0;
      for (const row of tables[name] || []) {
        if (apply([row], filters).length) { Object.assign(row, patch); n++; }
      }
      return { updated: n };
    },
  });
  return { table, tableMissing: (name) => missing.includes(name) || !(name in tables) };
}

const NOW = new Date("2026-10-16T09:30:00Z");
const deps = (tables, env = {}, missing = []) => ({ db: makeDb(tables, missing), env, now: () => NOW });

function stuckRow(id, lastError, attempts = 3, resets = 0) {
  return {
    id,
    completion_email_status: "failed",
    completion_email_sent_at: null,
    completion_email_last_error: lastError,
    completion_email_attempt_count: attempts,
    completion_email_next_retry_at: null,
    completion_email_permanent_failure: null,
    updated_at: "2026-10-06T12:00:00Z",
    metadata: resets ? { generationEmail: { keeper_reset_count: resets } } : {},
  };
}

// The known Oct-2026 incident shape: 12 stuck, mostly provider-era
// ("API key is invalid." from the old Resend era) + older permanent blocks.
const INCIDENT_ROWS = [
  ...Array.from({ length: 10 }, (_, i) => stuckRow(`trip-provider-${i}`, "API key is invalid.")),
  ...Array.from({ length: 2 }, (_, i) => stuckRow(`trip-blocked-${i}`, "Production email recipient is blocked.")),
];

const SMTP_READY = {
  ROAMLY_EMAIL_PROVIDER: "smtp",
  ROAMLY_SMTP_HOST: "smtp.gmail.com",
  ROAMLY_SMTP_PORT: "587",
  ROAMLY_SMTP_USER: "support@roamlyhq.com",
  ROAMLY_SMTP_PASSWORD: "app-password-value",
};

test("classifyEmailError: provider-era, permanent, unknown", () => {
  assert.equal(keeper.classifyEmailError("API key is invalid."), "provider-era");
  assert.equal(keeper.classifyEmailError("Production email recipient is blocked."), "permanent");
  assert.equal(keeper.classifyEmailError("something weird"), "unknown");
  assert.equal(keeper.classifyEmailError(null), "unknown");
});

test("keeperSenderReady: ready only with all four smtp vars; never prints values", () => {
  const ready = keeper.keeperSenderReady(SMTP_READY);
  assert.equal(ready.ready, true);
  const notReady = keeper.keeperSenderReady({ ...SMTP_READY, ROAMLY_SMTP_PASSWORD: "" });
  assert.equal(notReady.ready, false);
  assert.match(notReady.detail, /ROAMLY_SMTP_PASSWORD/);
  assert.ok(!notReady.detail.includes("app-password-value"), "secret value must not leak");
});

test("the stuck-email catch: 12 stuck rows read DOWN with counts + classes", async () => {
  const d = deps({ roamly_trips: INCIDENT_ROWS });
  const report = await keeper.runKeeperSuite(d, "keeper.roamly.test");
  const email = report.checks.find((c) => c.lane === "completion_email_queue");
  assert.equal(email.status, "down");
  assert.equal(email.evidence.stuckCount, 12);
  assert.equal(email.evidence.errorClasses["provider-era"], 10);
  assert.equal(email.evidence.errorClasses.permanent, 2);
});

test("healthy queue reads healthy", async () => {
  const d = deps({ roamly_trips: [] });
  const email = (await keeper.runKeeperSuite(d, "keeper.roamly.test")).checks.find((c) => c.lane === "completion_email_queue");
  assert.equal(email.status, "healthy");
});

test("kill switch: repairs OFF -> stuck queue escalates, nothing redriven", async () => {
  delete process.env.ROAMLY_KEEPER_REPAIRS;
  const d = deps({ roamly_trips: INCIDENT_ROWS });
  const report = await keeper.runKeeperSuite(d, "keeper.roamly.test");
  assert.equal(report.repair, null);
  assert.equal(report.repairsEnabled, false);
  assert.ok(report.escalations.some((e) => e.causeClass === "repairs-disabled"));
  assert.ok(INCIDENT_ROWS.every((r) => r.completion_email_next_retry_at === null), "no writes when off");
});

test("whitelist repair: redrives provider-era rows only, capped per run, permanent ones escalate", async () => {
  process.env.ROAMLY_KEEPER_REPAIRS = "on";
  const rows = INCIDENT_ROWS.map((r) => ({ ...r, metadata: {} }));
  const d = deps({ roamly_trips: rows }, SMTP_READY);
  const report = await keeper.runKeeperSuite(d, "keeper.roamly.test");
  assert.ok(report.repair);
  assert.equal(report.repair.redriven.length, keeper.REPAIR_MAX_PER_RUN);
  assert.ok(report.repair.redriven.every((id) => id.startsWith("trip-provider-")));
  assert.ok(report.repair.escalations.some((e) => e.causeClass === "permanent-recipient-failure"));
  assert.ok(!report.repair.redriven.includes("trip-blocked-0"), "blocked recipient never redriven");
  const redriven = rows.filter((r) => report.repair.redriven.includes(r.id));
  assert.ok(redriven.every((r) => r.completion_email_status === "pending" && r.completion_email_next_retry_at === NOW.toISOString()));
  assert.ok(redriven.every((r) => r.metadata.generationEmail.keeper_reset_count === 1));
  delete process.env.ROAMLY_KEEPER_REPAIRS;
});

test("repair failing twice stops and escalates (per-trip cap)", async () => {
  process.env.ROAMLY_KEEPER_REPAIRS = "on";
  const rows = [
    stuckRow("trip-twice", "API key is invalid.", 4, 2),
    stuckRow("trip-ok-1", "API key is invalid."),
    stuckRow("trip-ok-2", "API key is invalid."),
  ];
  const d = deps({ roamly_trips: rows }, SMTP_READY);
  const report = await keeper.runKeeperSuite(d, "keeper.roamly.test");
  const esc = report.repair.escalations.find((e) => e.causeClass === "repair-failed-twice");
  assert.ok(esc, "expected repair-failed-twice escalation");
  assert.equal(report.repair.redriven.length, 2, "the two eligible trips still redrive");
  assert.ok(!report.repair.redriven.includes("trip-twice"), "the twice-repaired trip is refused");
  delete process.env.ROAMLY_KEEPER_REPAIRS;
});

test("sender not ready -> repair refuses and escalates with the Junel action", async () => {
  process.env.ROAMLY_KEEPER_REPAIRS = "on";
  const d = deps({ roamly_trips: INCIDENT_ROWS.map((r) => ({ ...r })) }, {});
  const report = await keeper.runKeeperSuite(d, "keeper.roamly.test");
  assert.equal(report.repair.applied, false);
  const esc = report.repair.escalations.find((e) => e.causeClass === "sender-not-ready");
  assert.ok(esc);
  assert.match(esc.humanAction, /Junel/);
  assert.match(esc.humanAction, /App Password/i);
  delete process.env.ROAMLY_KEEPER_REPAIRS;
});

test("write guard: billing tables and price/provenance fields refused", () => {
  assert.equal(keeper.keeperWriteGuard("roamly_entitlements", { free_itinerary_used_at: "x" }).allowed, false);
  assert.equal(keeper.keeperWriteGuard("roamly_trips", { price_provenance: "UNKNOWN" }).allowed, false);
  assert.equal(keeper.keeperWriteGuard("roamly_trips", { budget_amount: 100 }).allowed, false);
  assert.equal(keeper.keeperWriteGuard("roamly_trips", { completion_email_status: "pending" }).allowed, true);
});

test("non-whitelisted repairs are refused, never improvised", () => {
  const refused = keeper.refuseRepair("social_autopost", "republish failed reels");
  assert.equal(refused.applied, false);
  assert.match(refused.reason, /whitelist/);
});

test("social autopost: stale cadence reads down; on-track reads healthy", async () => {
  const old = new Date(NOW.getTime() - 48 * 3_600_000).toISOString();
  const fresh = new Date(NOW.getTime() - 5 * 3_600_000).toISOString();
  const staleDb = deps({ roamly_scheduled_posts: [{ id: "p1", status: "published", published_at: old, created_at: old }] });
  const stale = (await keeper.runKeeperSuite(staleDb, "k")).checks.find((c) => c.lane === "social_autopost");
  assert.equal(stale.status, "down");
  const freshDb = deps({ roamly_scheduled_posts: [{ id: "p1", status: "published", published_at: fresh, created_at: fresh }] });
  const healthy = (await keeper.runKeeperSuite(freshDb, "k")).checks.find((c) => c.lane === "social_autopost");
  assert.equal(healthy.status, "healthy");
});

test("fail-soft: missing tables degrade, never throw", async () => {
  const d = deps({}, {}, ["roamly_trips", "roamly_scheduled_posts", "roamly_fyi_upsell_moments", "roamly_ops_owner_decisions", "roamly_ops_jobs"]);
  const report = await keeper.runKeeperSuite(d, "keeper.roamly.test");
  assert.ok(report.checks.every((c) => c.status !== "down" || c.lane === "config_flags"));
  assert.ok(report.checks.every((c) => ["healthy", "degraded", "down"].includes(c.status)));
});

test("escalation carries lane, evidence, cause class, and the exact human action", async () => {
  process.env.ROAMLY_KEEPER_REPAIRS = "on";
  const d = deps({ roamly_trips: INCIDENT_ROWS.map((r) => ({ ...r, metadata: {} })) }, SMTP_READY);
  const report = await keeper.runKeeperSuite(d, "keeper.roamly.test");
  for (const e of report.escalations) {
    assert.ok(e.lane && e.evidence && e.causeClass && e.humanAction, "escalation shape");
  }
  const permanent = report.escalations.find((e) => e.causeClass === "permanent-recipient-failure");
  assert.match(permanent.humanAction, /never retry a permanent failure/i);
  delete process.env.ROAMLY_KEEPER_REPAIRS;
});
