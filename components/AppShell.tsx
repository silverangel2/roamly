import { AppShellClient } from "@/components/AppShellClient";
import { getCurrentUser } from "@/lib/supabase/server";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const current = await getCurrentUser();

  return (
    <AppShellClient
      initialAuth={{
        authenticated: Boolean(current.user),
        email: current.user?.email || null
      }}
    >
      {children}
    </AppShellClient>
  );
}
