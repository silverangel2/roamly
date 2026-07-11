import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/navigation";

type SignupPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = safeNextPath(params.next);
  const current = await getCurrentUser();

  if (current.configured && current.user) {
    redirect(nextPath);
  }

  return (
    <main className="safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
      <section className="space-y-5">
        <Badge tone="sun">Free account</Badge>
        <h1 className="max-w-2xl text-4xl font-black leading-tight tracking-tight text-ink sm:text-6xl">
          Create your trip space.
        </h1>
        <p className="max-w-xl text-base font-semibold leading-7 text-slate-600">
          Start with one free itinerary per account. If you used ReviewIntel with Google, use that same email here.
        </p>
        <div className="rounded-[2rem] border border-orange-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_58%,#ecfeff_100%)] p-5 text-ink shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Simple accounts</p>
          <p className="mt-3 text-2xl font-black">One free itinerary now. One-time trip packs later.</p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            No buyer/seller/admin tier complexity. Roamly stays light.
          </p>
        </div>
      </section>

      <Card className="mx-auto w-full max-w-md">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Roamly account</p>
        <h2 className="mt-2 text-2xl font-black text-ink">Create account</h2>
        <div className="mt-5">
          <AuthForm mode="signup" nextPath={nextPath} />
        </div>
      </Card>
    </main>
  );
}
