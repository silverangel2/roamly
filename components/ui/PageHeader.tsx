import { Badge } from "@/components/ui/Badge";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className="space-y-3">
      {eyebrow ? <Badge>{eyebrow}</Badge> : null}
      <h1 className="max-w-3xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
        {title}
      </h1>
      {description ? (
        <p className="max-w-2xl text-base font-semibold leading-7 text-slate-600">
          {description}
        </p>
      ) : null}
    </header>
  );
}
