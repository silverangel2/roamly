import { Card } from "@/components/ui/Card";

export function AdminStatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{label}</p>
      <p className="mt-2 text-3xl font-black text-ink">{value}</p>
    </Card>
  );
}
