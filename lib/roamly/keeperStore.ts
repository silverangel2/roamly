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
import type { KeeperDb, KeeperDbFilter } from "@/lib/roamly/roamlyKeeper";

function applyFilter(query: any, f: KeeperDbFilter): any {
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
  const message = String((error as any)?.message || error || "");
  return /does not exist|relation .* not found|42P01/i.test(message);
}

export function supabaseKeeperDb(admin: SupabaseClient): KeeperDb {
  const missing = new Set<string>();
  const table = (name: string) => ({
    count: async (filters: KeeperDbFilter[]): Promise<number> => {
      let query: any = admin.from(name).select("id", { count: "exact", head: true });
      for (const f of filters) query = applyFilter(query, f);
      const result = await query;
      if (result.error) {
        if (tableMissingFrom(result.error)) missing.add(name);
        throw new Error(result.error.message);
      }
      return result.count ?? 0;
    },
    rows: async (filters: KeeperDbFilter[], opts: { limit?: number; order?: string; columns?: string } = {}): Promise<any[]> => {
      let query: any = admin.from(name).select(opts.columns || "*");
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
      return (result.data || []) as any[];
    },
    update: async (patch: Record<string, unknown>, filters: KeeperDbFilter[]): Promise<{ updated: number }> => {
      let query: any = admin.from(name).update(patch);
      for (const f of filters) query = applyFilter(query, f);
      const result = await query.select("id");
      if (result.error) throw new Error(result.error.message);
      return { updated: (result.data || []).length };
    },
  });
  return { table, tableMissing: (name) => missing.has(name) };
}
