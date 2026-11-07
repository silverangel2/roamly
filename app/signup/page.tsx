import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthForm } from "@/components/auth/AuthForm";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiCard } from "@/components/boardui/Card";
import { getCurrentUser } from "@/lib/supabase/server";
import { safeAuthNextPath } from "@/lib/navigation";

type SignupPageProps = {
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

export const metadata: Metadata = {
  title: "Create Your Free Roamly Account",
  description: "Sign up free and build one custom trip itinerary. Keep every trip, plan, and booking in one place — no subscription required.",
  openGraph: {
    title: "Create your free Roamly account",
    description: "Sign up free, build one custom trip itinerary, and keep every trip in one place.",
    url: "https://roamlyhq.com/signup",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const cookieNext = readCookieNext(cookieStore.get(AUTH_NEXT_COOKIE)?.value);
  const nextPath = selectAuthNextPath(params.next, cookieNext);
  const current = await getCurrentUser();

  if (current.configured && current.user) {
    redirect(nextPath);
  }

  return (
    <div className="bg-cbg">
      <div className="bui-safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
        {/* Apply-All Sweep (2026-11-03): same auth treatment as
            login — token ground + the Round 1 pricing hero panel;
            the "Simple accounts" card becomes an inset block inside
            the panel. Copy unchanged. */}
        <section className="bui-enter overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#E6EFFA_52%,#FFF0E6)] p-6 shadow-bui-hero sm:p-10">
          <BuiBadge tone="warm">Free account</BuiBadge>
          <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight tracking-tight text-chead sm:text-6xl">
            Create your trip space.
          </h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-cink">
            Start with one free itinerary per Roamly profile. Use email or Google to keep every trip in one place.
          </p>
          <div className="mt-6 rounded-2xl bg-white/85 p-4 text-chead shadow-[inset_0_0_0_1px_rgba(220,229,240,0.85)]">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-corange">Simple accounts</p>
            <p className="mt-3 text-2xl font-black">One free itinerary now. One-time trip packs later.</p>
            <p className="mt-2 text-sm font-bold leading-6 text-cink">
              One account, one kind of traveller. No subscriptions, no tiers to decode.
            </p>
          </div>
        </section>

        <BuiCard className="bui-enter mx-auto w-full max-w-md rounded-bui-panel p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Roamly account</p>
          <h2 className="mt-2 text-2xl font-black text-chead">Create account</h2>
          <div className="mt-5">
            <AuthForm mode="signup" nextPath={nextPath} />
          </div>
        </BuiCard>
      </div>
    </div>
  );
}
