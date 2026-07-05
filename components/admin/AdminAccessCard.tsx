import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

export function AdminAccessCard({ reason = "Admin access is protected." }: { reason?: string }) {
  return (
    <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
      <Card>
        <Badge tone="coral">Admin protected</Badge>
        <h1 className="mt-4 text-3xl font-black text-ink">Roamly admin is private.</h1>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{reason}</p>
      </Card>
    </main>
  );
}
