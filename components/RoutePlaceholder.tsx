import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type RoutePlaceholderProps = {
  title: string;
  phase: string;
  summary: string;
  nextAction?: string;
};

export function RoutePlaceholder({ title, phase, summary, nextAction = "Plan my trip" }: RoutePlaceholderProps) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-5xl flex-col justify-center px-4 py-8 sm:px-6">
      <Card className="overflow-hidden">
        <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-lagoon/20 blur-3xl" />
        <div className="relative space-y-5">
          <Badge tone="sun">{phase}</Badge>
          <div className="space-y-3">
            <h1 className="text-3xl font-black tracking-tight text-ink sm:text-5xl">{title}</h1>
            <p className="max-w-2xl text-base font-semibold leading-7 text-slate-600">{summary}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button href="/plan">{nextAction}</Button>
            <Button href="/" tone="secondary">Back home</Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
