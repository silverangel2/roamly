import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { SocialPostCards } from "@/components/admin/social/SocialPostCards";
import { Badge } from "@/components/ui/Badge";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { isSocialTableMissingError } from "@/lib/roamly/social";

export default async function AdminSocialHistoryPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const history = await state.admin
    .from("roamly_social_post_history")
    .select("id,platform,status,title,caption,hashtags,destination,topic,scheduled_for,posted_at,error_message,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const tableReady = !isSocialTableMissingError(history.error);

  return (
    <main className="safe-bottom">
      <Badge>History</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Social history.</h1>
      <section className="mt-6">
        <SocialPostCards posts={tableReady ? history.data || [] : []} empty={tableReady ? "No social history yet." : "Run the social migration to enable history."} />
      </section>
    </main>
  );
}
