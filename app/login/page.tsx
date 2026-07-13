import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthForm } from "@/components/auth/AuthForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/supabase/server";
import { safeAuthNextPath } from "@/lib/navigation";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const AUTH_NEXT_COOKIE = "roamly_auth_next";

function readCookieNext(value?: string) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathnameFromPath(path: string) {
  return path.split(/[?#]/, 1)[0];
}

function selectAuthNextPath(queryNext: string | string[] | undefined, cookieNext: string | undefined) {
  const nextPath = safeAuthNextPath(queryNext);
  const pendingPlannerNext = safeAuthNextPath(cookieNext, "");

  if (pathnameFromPath(pendingPlannerNext) === "/plan") {
    const nextPathname = pathnameFromPath(nextPath);
    if (nextPathname === "/plan" || nextPathname === "/dashboard") return pendingPlannerNext;
  }

  return nextPath;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const cookieNext = readCookieNext(cookieStore.get(AUTH_NEXT_COOKIE)?.value);
  const nextPath = selectAuthNextPath(params.next, cookieNext);
  const authError = typeof params.error === "string" ? params.error : "";
  const current = await getCurrentUser();
  const authErrorMessage = authError
    ? authError === "supabase_not_configured"
      ? "Supabase is not configured yet."
      : "We could not sign you in. Please try again."
    : "";

  if (current.configured && current.user) {
    redirect(nextPath);
  }

  return (
    <main className="safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
      <section className="space-y-5">
        <Badge>Welcome back</Badge>
        <h1 className="max-w-2xl text-4xl font-black leading-tight tracking-tight text-ink sm:text-6xl">
          Log in and keep your trips together.
        </h1>
        <p className="max-w-xl text-base font-semibold leading-7 text-slate-600">
          Roamly uses standalone Supabase Auth with dedicated profile and trip records.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {["Saved trips", "1 free itinerary", "One-time trip packs"].map((item) => (
            <div key={item} className="rounded-2xl bg-white/80 p-4 text-sm font-black text-ink shadow-soft">
              {item}
            </div>
          ))}
        </div>
      </section>

      <Card className="mx-auto w-full max-w-md">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Roamly account</p>
        <h2 className="mt-2 text-2xl font-black text-ink">Log in</h2>
        <div className="mt-5">
          <AuthForm mode="login" nextPath={nextPath} initialError={authErrorMessage} />
        </div>
      </Card>
    </main>
  );
}
