import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const source = fs.readFileSync(path.join(root, "lib/roamly/travelEmailFiltering.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const sandbox = {
  exports: {},
  module: { exports: {} },
  require(id) {
    if (id === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => null };
    return require(id);
  },
  process,
  Date
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox, { filename: "travelEmailFiltering.ts" });
const { recordTravelEmailFilterResult } = sandbox.module.exports;

let databaseAccesses = 0;
const ignored = await recordTravelEmailFilterResult({
  supabase: {
    from() {
      databaseAccesses += 1;
      throw new Error("Non-travel email metadata must not reach storage.");
    }
  },
  connection: { id: "connection-a", user_id: "user-a" },
  metadata: {
    provider: "gmail",
    messageId: "personal-message",
    sender: "friend@example.com",
    subject: "Weekend lunch plans",
    snippet: "Are we still meeting at the usual place this weekend?"
  }
});
assert.equal(ignored.skipped, true, "messages that fail the travel filter must be skipped");
assert.equal(ignored.filter.shouldProcess, false, "personal message must not be classified as travel");
assert.equal(databaseAccesses, 0, "non-travel message metadata must not reach the database");

const storedRows = [];
const relevant = await recordTravelEmailFilterResult({
  supabase: {
    from(table) {
      databaseAccesses += 1;
      return {
        upsert(payload) {
          storedRows.push({ table, payload });
          return {
            select() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: "travel-message-row" }, error: null };
            }
          };
        }
      };
    }
  },
  connection: { id: "connection-a", user_id: "user-a" },
  metadata: {
    provider: "gmail",
    messageId: "travel-message",
    sender: "Klook <booking@klook.com>",
    subject: "Klook activity confirmation",
    snippet: "Voucher ABC12345 for Old Montreal Walking Tour on Aug 6, 2026 at 10:00 AM"
  }
});
assert.equal(relevant.saved, true, "travel-related message metadata must remain available for booking extraction");
assert.equal(storedRows.length, 1, "exactly one relevant message metadata row must be stored");
assert.equal(storedRows[0].table, "travel_email_messages");
assert.equal(storedRows[0].payload.raw_body_retained, false, "raw email bodies must remain excluded from storage");
assert.equal(Object.hasOwn(storedRows[0].payload, "bodyText"), false, "message body text must not be persisted");

const connectionsSource = fs.readFileSync(path.join(root, "lib/roamly/emailConnections.ts"), "utf8");
assert.match(connectionsSource, /retryable:\s*saved\.filter\.shouldProcess\s*&&\s*!saved\.saved/, "filter skips must not cause endless sync retries");

console.log("Roamly email storage privacy checks passed.");
