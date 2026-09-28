import Link from "next/link";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { listOperationsJobs } from "@/lib/roamly/opsStore";
import { safeFindingSummary } from "@/lib/roamly/gapAuditSpecialist";

const terminal = new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]);

export default async function OperationsPage() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return <main className="rounded-3xl border border-cloud bg-white p-6"><h1 className="text-2xl font-black text-ink">Operations access required</h1></main>;
  const result = await listOperationsJobs(guard.admin, 100);
  const jobs = result.ok ? result.jobs : [];
  const active = jobs.filter((job) => !terminal.has(String(job.status))).length;
  const blocked = jobs.filter((job) => job.status === "BLOCKED").length;
  const awaiting = jobs.filter((job) => job.status === "AWAITING_APPROVAL").length;
  return <main className="space-y-5"><section className="rounded-3xl border border-cloud bg-white p-5 shadow-soft sm:p-7"><p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Internal control plane</p><h1 className="mt-2 text-3xl font-black text-ink">Autonomous Operations</h1><p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">Phase 2 Gap Audit + QA is deterministic and capped at observation/diagnosis. No AI workers, production mutations, commits, deployments, or customer-data access are enabled.</p><div className="mt-5 grid gap-3 sm:grid-cols-3">{[["Active", active], ["Blocked", blocked], ["Awaiting owner", awaiting]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-mist/50 p-4"><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-ink">{value}</p></div>)}</div></section><section className="overflow-hidden rounded-3xl border border-cloud bg-white shadow-soft"><div className="border-b border-cloud px-5 py-4"><h2 className="font-black text-ink">Queue and evidence ledger</h2></div>{!result.ok ? <p className="p-5 text-sm font-bold text-slate-500">Operations tables are not available yet.</p> : jobs.length ? <div className="divide-y divide-cloud">{jobs.map((job) => { const finding = safeFindingSummary(job.scope_json); return <Link key={job.id} href={`/admin/operations/${job.id}`} className="block px-5 py-4 transition hover:bg-mist/40"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-ink">{job.objective}</p><span className="rounded-full bg-mist px-3 py-1 text-xs font-black text-slate-600">{job.status}</span></div><p className="mt-1 text-xs font-bold text-slate-500">{job.role} · {job.subsystem} · {job.priority} · {job.authority_level}</p>{finding ? <p className="mt-1 text-xs font-bold text-coral">{finding.findingId} · {finding.severity} · {finding.confirmed ? "confirmed" : "suspected"}</p> : null}<p className="mt-1 text-xs text-slate-400">{job.created_at}</p></Link>})}</div> : <p className="p-5 text-sm font-bold text-slate-500">No operations jobs recorded.</p>}</section></main>;
}
