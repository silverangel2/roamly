import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTripBundle } from "@/lib/trips";

export default async function AdminFieldTestEntry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect(`/login?next=${encodeURIComponent(`/field-test/${id}`)}`);
  if (!current.configured || !current.user) redirect("/dashboard");
  const access = getRoamlyAccessForUser(current.user.email);
  const supabase = await createSupabaseServerClient();
  if (!supabase || !access.hasQaAccess) redirect("/dashboard?tripAccess=denied");
  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data || bundle.data.trip.metadata?.field_test !== true) redirect("/dashboard?tripAccess=denied");
  redirect(`/trip/${id}/live?fieldTest=1`);
}
