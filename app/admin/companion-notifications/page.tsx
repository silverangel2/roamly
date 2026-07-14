import { redirect } from "next/navigation";
import CompanionNotificationConsole from "@/components/admin/CompanionNotificationConsole";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function CompanionNotificationsPage() {
  const state = await getRoamlyAdminPageState();

  if (!state.user) {
    redirect(
      "/login?next=/admin/companion-notifications"
    );
  }

  if (!state.isAdmin) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <CompanionNotificationConsole />
    </main>
  );
}
