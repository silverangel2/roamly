import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { AffiliateLinkTestButton } from "@/components/admin/AffiliateLinkTestButton";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getAffiliateReadiness } from "@/lib/roamly/affiliateLinks";

function statusText(configured: boolean, enabled: boolean) {
  if (!enabled) return "Disabled";
  return configured ? "Configured" : "Missing configuration";
}

export default async function AdminAffiliatesPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const readiness = getAffiliateReadiness();
  const statuses = readiness.providerStatuses || [];

  return (
    <main className="safe-bottom">
      <Badge>Affiliates</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Affiliate settings.</h1>
      <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
        Approved partner routing is centralized here: Travelpayouts for flights, Stay22 for stays, Klook for activities and transfers, Amazon for travel products, and the configured eSIM provider for connectivity.
      </p>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statuses.map((status) => (
          <Card key={`${status.provider}-${status.category}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{status.category}</p>
                <h2 className="mt-2 text-xl font-black text-ink">{status.provider}</h2>
              </div>
              <span className="rounded-full border border-ocean/20 bg-ocean/10 px-3 py-1 text-xs font-black text-ocean">
                Priority {status.priority}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-sm font-bold leading-6 text-slate-600">
              <p>Status: {statusText(status.configured, status.enabled)}</p>
              <p>Enabled: {status.enabled ? "yes" : "no"}</p>
              <p>Link test: {status.finalUrlValid ? "valid" : "invalid"}</p>
              <p>Fallback: {status.fallbackBehavior}</p>
              <p>Disclosure: {status.disclosureRequired ? "required" : "not required"}</p>
              <p>Missing: {status.missingConfiguration.length ? status.missingConfiguration.join(", ") : "none"}</p>
            </div>
          </Card>
        ))}
      </section>

      <section className="mt-6 rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Validation</p>
            <h2 className="mt-2 text-2xl font-black text-ink">Test affiliate links</h2>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              Generates sample URLs through the centralized resolver and reports validity, fallback behavior, missing configuration, and disclosure requirements without exposing IDs or secrets.
            </p>
            <p className="mt-2 text-xs font-bold text-slate-500">Last validation: {new Date(readiness.linkTest.testedAt).toLocaleString()}</p>
          </div>
          <AffiliateLinkTestButton />
        </div>
      </section>
    </main>
  );
}
