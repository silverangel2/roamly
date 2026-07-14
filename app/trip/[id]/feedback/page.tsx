import { redirect } from "next/navigation";
import { TripFeedbackForm } from "@/components/trip/TripFeedbackForm";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function TripFeedbackPage({ params }: PageProps) {
  const { id } = await params;
  const current = await getCurrentUser();
  if (!current.configured) {
    return (
      <main className="safe-bottom mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-black text-ink">Supabase setup required.</h1>
      </main>
    );
  }
  if (!current.user) redirect(`/login?next=/trip/${id}/feedback`);

  const supabase = await createSupabaseServerClient();
  const trip = supabase
    ? await supabase.from("roamly_trips").select("id,title,destination,destination_name").eq("id", id).eq("user_id", current.user.id).maybeSingle()
    : { data: null };
  if (!trip.data) redirect("/dashboard");
  const title = trip.data.title || trip.data.destination_name || trip.data.destination || "Trip";

  return (
    <main className="safe-bottom mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Feedback</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-ink">{title}</h1>
      </div>
      <TripFeedbackForm tripId={id} />
    </main>
  );
}
