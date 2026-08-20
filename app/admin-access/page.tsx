import { Card } from "@/components/ui/Card";

export default async function AdminAccessPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;

  return (
    <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-6rem)] w-full max-w-lg items-center px-4 py-10 sm:px-6">
      <Card>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
          Roamly Admin
        </p>

        <h1 className="mt-3 text-3xl font-black text-ink">
          Admin sign in
        </h1>

        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
          Enter the admin passcode to continue.
        </p>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error === "setup"
              ? "Admin access is not configured."
              : "Invalid admin credentials."}
          </div>
        ) : null}

        <form
          action="/api/admin/access"
          method="post"
          className="mt-6 grid gap-4"
        >
          <label className="grid gap-2">
            <span className="text-sm font-black text-ink">
              Password
            </span>

            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-ocean/10"
            />
          </label>

          <button
            type="submit"
            className="mt-2 rounded-full bg-ink px-5 py-3 text-sm font-black text-white transition hover:opacity-90"
          >
            Sign in
          </button>
        </form>
      </Card>
    </main>
  );
}
