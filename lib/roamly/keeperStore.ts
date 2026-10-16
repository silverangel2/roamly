/**
 * Production KeeperDb adapter: maps the keeper's small normalized interface
 * onto supabase-js chains against Roamly's own tables. Read-only except the
 * whitelisted update path, which is still gated by keeperWriteGuard inside
 * lib/roamly/roamlyKeeper.ts before it ever reaches this adapter.
 *
 * Ship path: lib/roamly/keeperStore.ts (this file). New file, no existing
 * code touched.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeeperDb, KeeperDbFilter, KeeperDbRow } from "@/lib/roamly/roamlyKeeper";

/**
 * Structural view of the supabase-js query builders this adapter uses. The
 * client is untyped (no generated Database types in this repo), so the
 * adapter programs against the chain shape it actually calls.
 */
type KeeperPostgrestResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

type KeeperPostgrestQuery = PromiseLike<KeeperPostgrestResult> & {
  eq: (column: string, value: unknown) => KeeperPostgrestQuery;
  neq: (column: string, value: unknown) => KeeperPostgrestQuery;
  is: (column: string, value: unknown) => KeeperPostgrestQuery;
  in: (column: string, values: unknown[]) => KeeperPostgrestQuery;
  lt: (column: string, value: unknown) => KeeperPostgrestQuery;
  gte: (column: string, value: unknown) => KeeperPostgrestQuery;
  order: (column: string, options: { ascending: boolean }) => KeeperPostgrestQuery;
  limit: (count: number) => KeeperPostgrestQuery;
  select: (columns: string) => PromiseLike<KeeperPostgrestResult>;
};

function applyFilter(query: KeeperPostgrestQuery, f: KeeperDbFilter): KeeperPostgrestQuery {
  switch (f.op) {
    case "eq":
      return query.eq(f.column, f.value);
    case "neq":
      return query.neq(f.column, f.value);
    case "is":
      return query.is(f.column, f.value);
    case "in":
      return query.in(f.column, Array.isArray(f.value) ? f.value : []);
    case "lt":
      return query.lt(f.column, f.value);
    case "gte":
      return query.gte(f.column, f.value);
    default:
      return query;
  }
}

function tableMissingFrom(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null | undefined)?.message || error || "");
  return /does not exist|relation .* not found|42P01/i.test(message);
}

export function supabaseKeeperDb(admin: SupabaseClient): KeeperDb {
  const missing = new Set<string>();
  const table = (name: string) => ({
    count: async (filters: KeeperDbFilter[]): Promise<number> => {
      let query = admin.from(name).select("id", { count: "exact", head: true }) as unknown as KeeperPostgrestQuery;
      for (const f of filters) query = applyFilter(query, f);
      const result = await query;
      if (result.error) {
        if (tableMissingFrom(result.error)) missing.add(name);
        throw new Error(result.error.message);
      }
      return result.count ?? 0;
    },
    rows: async (filters: KeeperDbFilter[], opts: { limit?: number; order?: string; columns?: string } = {}): Promise<KeeperDbRow[]> => {
      let query = admin.from(name).select(opts.columns || "*") as unknown as KeeperPostgrestQuery;
      for (const f of filters) query = applyFilter(query, f);
      if (opts.order) {
        const [column, dir] = opts.order.split(" ");
        query = query.order(column, { ascending: !/desc/i.test(dir || "") });
      }
      if (opts.limit) query = query.limit(opts.limit);
      const result = await query;
      if (result.error) {
        if (tableMissingFrom(result.error)) missing.add(name);
        throw new Error(result.error.message);
      }
      return (Array.isArray(result.data) ? result.data : []) as KeeperDbRow[];
    },
    update: async (patch: Record<string, unknown>, filters: KeeperDbFilter[]): Promise<{ updated: number }> => {
      let query = admin.from(name).update(patch) as unknown as KeeperPostgrestQuery;
      for (const f of filters) query = applyFilter(query, f);
      const result = await query.select("id");
      if (result.error) throw new Error(result.error.message);
      return { updated: Array.isArray(result.data) ? result.data.length : 0 };
    },
  });
  return { table, tableMissing: (name) => missing.has(name) };
}
