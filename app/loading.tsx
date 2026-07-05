import { Card } from "@/components/ui/Card";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <div className="space-y-4">
          <div className="h-3 w-28 animate-pulse rounded-full bg-lagoon/40" />
          <div className="h-8 w-3/4 animate-pulse rounded-2xl bg-cloud" />
          <div className="space-y-2">
            <div className="h-4 animate-pulse rounded-full bg-cloud" />
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-cloud" />
          </div>
        </div>
      </Card>
    </main>
  );
}
