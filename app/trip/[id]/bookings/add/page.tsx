import { redirect } from "next/navigation";
import { ManualBookingForm } from "@/components/companion/ManualBookingForm";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle } from "@/lib/trips";

export default async function AddTripBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentUser();

  if (current.configured && !current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}/bookings/add`)}`);
  }

  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  return (
    <main className="safe-bottom min-h-[calc(100dvh-5rem)] bg-[#fbf8ef] text-ink">
      <ManualBookingForm tripId={id} />
    </main>
  );
}
