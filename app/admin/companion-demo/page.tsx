import { redirect } from "next/navigation";
import CompanionDemoConsole from "@/components/admin/CompanionDemoConsole";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function CompanionDemoPage() {
  const state = await getRoamlyAdminPageState();

  if (!state.user) {
    redirect("/login?next=/admin/companion-demo");
  }

  if (!state.isAdmin) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <CompanionDemoConsole />
    </main>
  );
}
