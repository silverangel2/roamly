import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

type AdminRoamlyProfile = {
  id: string;
  user_id?: string | null;
  email: string | null;
  full_name: string | null;
  first_seen_at?: string | null;
  created_at?: string | null;
};

async function loadProfiles(admin: NonNullable<Awaited<ReturnType<typeof getRoamlyAdminPageState>>["admin"]>) {
  const current = await admin
    .from("roamly_profiles")
    .select("id,user_id,email,full_name,first_seen_at")
    .order("first_seen_at", { ascending: false })
    .limit(100);

  if (!current.error) return (current.data || []) as AdminRoamlyProfile[];

  const legacy = await admin
    .from("roamly_profiles")
    .select("id,email,full_name,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (legacy.data || []) as AdminRoamlyProfile[];
}

export default async function AdminUsersPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const [profiles, { data: entitlements }, { data: purchases }] = await Promise.all([
    loadProfiles(state.admin),
    state.admin.from("roamly_user_entitlements").select("user_id,free_itinerary_used_at,free_itinerary_trip_id"),
    state.admin.from("roamly_itinerary_purchases").select("user_id,purchase_type,status")
  ]);

  const entitlementByUser = new Map((entitlements || []).map((row) => [row.user_id, row]));
  const purchasesByUser = new Map<string, Array<{ purchase_type: string; status: string }>>();
  for (const purchase of purchases || []) {
    if (!purchase.user_id) continue;
    purchasesByUser.set(purchase.user_id, [...(purchasesByUser.get(purchase.user_id) || []), purchase]);
  }

  return (
    <main className="safe-bottom">
      <Badge>Users</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Roamly users.</h1>
      <div className="mt-6 grid gap-3">
        {profiles.map((user) => {
          const authUserId = user.user_id || user.id;

          return (
            <Card key={user.id} className="p-4">
              <h2 className="text-xl font-black text-ink">{user.full_name || "Traveler"}</h2>
              <p className="mt-1 break-words text-sm font-bold text-slate-500">{user.email}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                <span className="rounded-full bg-mist px-3 py-2">
                  {entitlementByUser.get(authUserId)?.free_itinerary_used_at ? "free used" : "free available"}
                </span>
                <span className="rounded-full bg-mist px-3 py-2">
                  paid itinerary{" "}
                  {purchasesByUser.get(authUserId)?.filter((item) => item.status === "paid" && ["itinerary", "itinerary_unlock"].includes(item.purchase_type)).length || 0}
                </span>
                <span className="rounded-full bg-mist px-3 py-2">
                  companion {purchasesByUser.get(authUserId)?.filter((item) => item.status === "paid" && ["features", "tracking_addon"].includes(item.purchase_type)).length || 0}
                </span>
                <span className="rounded-full bg-mist px-3 py-2">
                  complete {purchasesByUser.get(authUserId)?.filter((item) => item.status === "paid" && ["complete_trip", "bundle"].includes(item.purchase_type)).length || 0}
                </span>
              </div>
            </Card>
          );
        })}
        {!profiles.length ? <Card>No user profiles yet.</Card> : null}
      </div>
    </main>
  );
}
