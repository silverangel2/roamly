// EGRESS DIET (2026-11-02) — instrumented fake Supabase client shared
// by the diet checks and the simulated-day harness. It executes the
// app's real query chains against in-memory tables and records, per
// query: table, select list, head/count mode, rows returned and
// RESPONSE BODY BYTES (JSON length of the returned data — the
// PostgREST egress a real run would pay). Head/count queries return
// no body (headers only) and record 0 body bytes. Writes record 0
// body bytes (PostgREST default 204/empty responses).
//
// Filter support covers the operators the diet lanes use: eq, neq,
// in, is, lt, lte, gt, gte, not, filter("a->>b"), and or(...) strings
// with and(...) groups and ->> terms. Comparisons on ISO strings are
// lexicographic, matching Postgres timestamptz ordering for the
// same-shaped values used here.

function accessor(row, column) {
  if (column.includes("->>")) {
    const [head, key] = column.split("->>");
    const base = row[head];
    return base && typeof base === "object" ? base[key] : undefined;
  }
  return row[column];
}

function parseValue(raw) {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("(") && value.endsWith(")")) {
    return value.slice(1, -1).split(",").map((part) => parseValue(part));
  }
  return value.replace(/^"|"$/g, "");
}

function compare(rowValue, op, value) {
  switch (op) {
    case "eq": return rowValue === value || String(rowValue ?? "") === String(value ?? "");
    case "neq": return rowValue !== value;
    case "in": return Array.isArray(value) && value.some((v) => String(rowValue ?? "") === String(v ?? ""));
    case "is": return (rowValue ?? null) === value;
    case "lt": return rowValue != null && String(rowValue) < String(value);
    case "lte": return rowValue != null && String(rowValue) <= String(value);
    case "gt": return rowValue != null && String(rowValue) > String(value);
    case "gte": return rowValue != null && String(rowValue) >= String(value);
    default: return false;
  }
}

function splitTopLevel(expr) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function evalOrTerm(row, term) {
  const text = term.trim();
  if (text.startsWith("and(") && text.endsWith(")")) {
    return splitTopLevel(text.slice(4, -1)).every((part) => evalOrTerm(row, part));
  }
  if (text.startsWith("or(") && text.endsWith(")")) {
    return splitTopLevel(text.slice(3, -1)).some((part) => evalOrTerm(row, part));
  }
  // term shape: column.op.value where column may contain ->> and the
  // value may contain dots (timestamps) — split on the FIRST two dots
  // from the left of the operator list.
  const match = text.match(/^(.+?)\.(eq|neq|in|is|lt|lte|gt|gte)\.(.+)$/);
  if (!match) return false;
  const [, column, op, raw] = match;
  return compare(accessor(row, column), op, parseValue(raw));
}

export class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.selectCols = null;
    this.countMode = null;
    this.head = false;
    this.orderSpec = [];
    this.limitN = null;
    this.rangeSpec = null;
    this.writeKind = null;
    this.writeRow = null;
  }
  select(cols, opts) {
    if (this.writeKind) return this; // update().select() — return written rows
    this.selectCols = cols;
    if (opts?.count) this.countMode = opts.count;
    if (opts?.head) this.head = true;
    return this;
  }
  eq(col, v) { this.filters.push((r) => compare(accessor(r, col), "eq", v)); return this; }
  neq(col, v) { this.filters.push((r) => compare(accessor(r, col), "neq", v)); return this; }
  in(col, vals) { this.filters.push((r) => compare(accessor(r, col), "in", vals)); return this; }
  is(col, v) { this.filters.push((r) => compare(accessor(r, col), "is", v)); return this; }
  not(col, op, v) { this.filters.push((r) => !compare(accessor(r, col), op === "is" ? "is" : op, v)); return this; }
  lt(col, v) { this.filters.push((r) => compare(accessor(r, col), "lt", v)); return this; }
  lte(col, v) { this.filters.push((r) => compare(accessor(r, col), "lte", v)); return this; }
  gt(col, v) { this.filters.push((r) => compare(accessor(r, col), "gt", v)); return this; }
  gte(col, v) { this.filters.push((r) => compare(accessor(r, col), "gte", v)); return this; }
  filter(expr, op, v) {
    const normalized = op === "eq" ? "eq" : op;
    this.filters.push((r) => compare(accessor(r, expr), normalized, v));
    return this;
  }
  or(expr) { this.filters.push((r) => splitTopLevel(expr).some((term) => evalOrTerm(r, term))); return this; }
  order(col, opts) { this.orderSpec.push({ col, asc: opts?.ascending !== false }); return this; }
  limit(n) { this.limitN = n; return this; }
  range(a, b) { this.rangeSpec = [a, b]; return this; }
  update(row) { this.writeKind = "update"; this.writeRow = row; return this; }
  insert(rows) { this.writeKind = "insert"; this.writeRow = rows; return this; }
  upsert(rows) { this.writeKind = "insert"; this.writeRow = rows; return this; }
  delete() { this.writeKind = "delete"; return this; }

  matched() {
    return (this.db.tables[this.table] || []).filter((r) => this.filters.every((f) => f(r)));
  }

  project(row) {
    if (!this.selectCols || this.selectCols === "*") return structuredClone(row);
    const out = {};
    for (const rawPart of this.selectCols.split(",")) {
      const part = rawPart.trim();
      if (!part) continue;
      const [alias, col] = part.includes(":") ? part.split(":") : [part, part];
      if (col.includes("->")) continue; // JSON-path selects not modelled as columns
      out[alias] = row[col] === undefined ? null : structuredClone(row[col]);
    }
    return out;
  }

  execute() {
    const startLog = this.db.log.length;
    if (this.writeKind === "update") {
      const rows = this.matched();
      for (const row of rows) Object.assign(row, this.writeRow);
      this.db.log.push({ table: this.table, kind: "update", rows: rows.length, bytes: 0 });
      return { data: this.selectCols ? rows.map((r) => this.project(r)) : null, error: null, count: null };
    }
    if (this.writeKind === "insert") {
      const rows = Array.isArray(this.writeRow) ? this.writeRow : [this.writeRow];
      const stored = rows.map((r) => ({ id: r.id || `fake-${Math.random().toString(36).slice(2, 10)}`, created_at: r.created_at || new Date().toISOString(), ...r }));
      (this.db.tables[this.table] = this.db.tables[this.table] || []).push(...stored);
      this.db.log.push({ table: this.table, kind: "insert", rows: stored.length, bytes: 0 });
      return { data: this.selectCols ? stored.map((r) => this.project(r)) : null, error: null, count: null };
    }
    if (this.writeKind === "delete") {
      const rows = this.matched();
      this.db.tables[this.table] = (this.db.tables[this.table] || []).filter((r) => !rows.includes(r));
      this.db.log.push({ table: this.table, kind: "delete", rows: rows.length, bytes: 0 });
      return { data: null, error: null, count: null };
    }
    let rows = this.matched();
    const totalMatched = rows.length;
    for (const spec of [...this.orderSpec].reverse()) {
      rows = [...rows].sort((a, b) => String(accessor(a, spec.col) ?? "").localeCompare(String(accessor(b, spec.col) ?? "")) * (spec.asc ? 1 : -1));
    }
    if (this.rangeSpec) rows = rows.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    if (this.head) {
      this.db.log.push({ table: this.table, kind: "count", select: this.selectCols, rows: 0, bytes: 0, count: totalMatched });
      return { data: null, error: null, count: totalMatched };
    }
    const data = rows.map((r) => this.project(r));
    const bytes = Buffer.byteLength(JSON.stringify(data));
    this.db.log.push({ table: this.table, kind: "select", select: this.selectCols || "*", rows: data.length, bytes, count: this.countMode ? totalMatched : null });
    void startLog;
    return { data, error: null, count: this.countMode ? totalMatched : null };
  }

  async maybeSingle() {
    const result = this.execute();
    if (Array.isArray(result.data)) return { data: result.data[0] ?? null, error: null, count: result.count };
    return result;
  }
  async single() {
    const result = this.execute();
    if (Array.isArray(result.data)) return { data: result.data[0] ?? null, error: null, count: result.count };
    return result;
  }
  then(resolve, reject) {
    try { resolve(this.execute()); } catch (error) { reject(error); }
  }
}

export class FakeDb {
  constructor(tables = {}) {
    this.tables = tables;
    this.log = [];
  }
  from(table) { return new FakeQuery(this, table); }
  async rpc(name) {
    this.log.push({ table: `rpc:${name}`, kind: "rpc", rows: 0, bytes: 24 });
    return { data: null, error: null };
  }
  resetLog() { this.log = []; }
  totalBytes() { return this.log.reduce((sum, entry) => sum + (entry.bytes || 0), 0); }
  totalQueries() { return this.log.length; }
  heavyReads() { return this.log.filter((entry) => entry.kind === "select" && (entry.bytes || 0) > 0); }
}
