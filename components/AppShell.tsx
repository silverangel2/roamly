import { AppShellClient } from "@/components/AppShellClient";
import { getServerLocale } from "@/lib/i18n-server";
import { getCurrentUser } from "@/lib/supabase/server";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const current = await getCurrentUser();
  // Flash-of-English fix (2026-11-12): the server locale is the
  // provider's initial state, so the first paint is already in the
  // picked language instead of English-until-hydration.
  const initialLocale = await getServerLocale();

  return (
    <AppShellClient
      initialLocale={initialLocale}
      initialAuth={{
        authenticated: Boolean(current.user),
        email: current.user?.email || null
      }}
    >
      {children}
    </AppShellClient>
  );
}
