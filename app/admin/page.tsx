import Link from "next/link";

const tools = [
  ["Live Companion QA", "/admin/live-test"],
  ["Social Automation", "/admin/social/automation"],
  ["Social Drafts", "/admin/social/drafts"],
  ["Social History", "/admin/social/history"],
  ["Social Library", "/admin/social/library"],
  ["Trips", "/admin/trips"],
  ["Users", "/admin/users"],
  ["System", "/admin/system"],
  ["Traffic", "/admin/traffic"],
  ["Launch Readiness", "/admin/launch"]
] as const;

export default function AdminPage() {
  return (
    <main>
      <section className="rounded-3xl border border-cloud bg-white p-5 shadow-soft sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
          Roamly Admin
        </p>

        <h1 className="mt-3 text-3xl font-black text-ink sm:text-4xl">
          Admin dashboard
        </h1>

        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          Choose an admin tool. Dashboard summaries are isolated from this landing
          page so an optional integration cannot take down Admin access.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tools.map(([title, href]) => (
            <Link
              key={href}
              href={href}
              className="min-h-24 rounded-2xl border border-cloud bg-mist/40 p-4 transition hover:-translate-y-0.5 hover:bg-white"
            >
              <p className="font-black text-ink">{title}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Open {title}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
