import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { SocialDraftComposer } from "@/components/admin/social/SocialDraftComposer";
import { SocialPostCards } from "@/components/admin/social/SocialPostCards";
import { Badge } from "@/components/ui/Badge";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import {
  ROAMLY_SOCIAL_AFFILIATE_PARTNERS,
  ROAMLY_SOCIAL_CONTENT_TYPES,
  isSocialTableMissingError
} from "@/lib/roamly/social";

export default async function AdminSocialDraftsPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const posts = await state.admin
    .from("roamly_social_posts")
    .select("id,platform,status,title,caption,hashtags,destination,topic,scheduled_for,posted_at,error_message,created_at")
    .in("status", ["draft", "scheduled", "approved"])
    .order("created_at", { ascending: false })
    .limit(80);
  const tableReady = !isSocialTableMissingError(posts.error);

  return (
    <main className="safe-bottom">
      <Badge>Social drafts</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Social drafts.</h1>

      <section className="mt-6">
        <SocialDraftComposer contentTypes={ROAMLY_SOCIAL_CONTENT_TYPES} affiliatePartners={ROAMLY_SOCIAL_AFFILIATE_PARTNERS} />
      </section>

      <section className="mt-6">
        <h2 className="text-2xl font-black text-ink">Saved drafts</h2>
        <div className="mt-4">
          <SocialPostCards posts={tableReady ? posts.data || [] : []} empty={tableReady ? "No saved social drafts yet." : "Run the social migration to enable drafts."} />
        </div>
      </section>
    </main>
  );
}
