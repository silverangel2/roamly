import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export default async function PreviewPage() {
  const current = await getCurrentUser();

  if (current.configured && !current.user) redirect("/login?next=/preview");

  if (!current.configured || !current.user) {
    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Itinerary</Badge>
          <h1 className="mt-4 text-3xl font-black text-ink">Plan a trip to generate an itinerary.</h1>
          <div className="mt-5">
            <Button href="/plan">Open planner</Button>
          </div>
        </Card>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = supabase
    ? await supabase
        .from("roamly_trips")
        .select("id")
        .eq("user_id", current.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (data?.id) redirect(`/trip/${data.id}`);

  return (
    <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
      <Card>
        <Badge>Itinerary</Badge>
        <h1 className="mt-4 text-3xl font-black text-ink">No itinerary yet.</h1>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">Create your free itinerary from the planner first.</p>
        <div className="mt-5">
          <Button href="/plan">Plan my trip</Button>
        </div>
      </Card>
    </main>
  );
}
