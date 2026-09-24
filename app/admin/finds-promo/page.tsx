import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { FindsPromoControls } from "@/components/admin/FindsPromoControls";
import { Badge } from "@/components/ui/Badge";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { readFindsPromoSetting } from "@/lib/roamly/findsPromoStore";

export default async function AdminFindsPromoPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;
  const setting = await readFindsPromoSetting();
  return <main className="safe-bottom"><Badge>Finds</Badge><h1 className="mt-4 text-4xl font-black text-ink">Finds promo</h1><p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">Manage the one rotating promotional feature shown inside the frozen Finds magazine. Use a legitimate tracked destination and keep the copy grounded.</p><section className="mt-6 max-w-4xl"><FindsPromoControls initialPromo={setting.promo} configured={setting.configured} /></section></main>;
}
