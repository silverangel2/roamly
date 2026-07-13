import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ROAMLY_AFFILIATE_DISCLOSURE } from "@/lib/roamly/emailTemplates";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { ROAMLY_SOCIAL_AFFILIATE_PARTNERS, ROAMLY_SOCIAL_CONTENT_TYPES } from "@/lib/roamly/social";

export default async function AdminSocialLibraryPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  return (
    <main className="safe-bottom">
      <Badge>Library</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Social content library.</h1>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ROAMLY_SOCIAL_CONTENT_TYPES.map((type) => (
          <Card key={type} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Roamly</p>
            <h2 className="mt-2 text-lg font-black text-ink">{type}</h2>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Affiliate partners</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ROAMLY_SOCIAL_AFFILIATE_PARTNERS.map((partner) => (
              <span key={partner} className="rounded-full bg-mist px-3 py-2 text-xs font-black text-ink">
                {partner}
              </span>
            ))}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Disclosure</p>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{ROAMLY_AFFILIATE_DISCLOSURE}</p>
        </Card>
      </section>
    </main>
  );
}
