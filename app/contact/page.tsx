import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function ContactPage() {
  const supportEmail = process.env.ROAMLY_SUPPORT_EMAIL || "support@roamly.app";

  return (
    <main className="safe-bottom mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Card className="overflow-hidden">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-ocean/20 blur-3xl" />
        <div className="relative">
          <Badge>Contact</Badge>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Need help with a trip?</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-600">
            Send the trip destination, account email, and a short description of what happened. Keep booking confirmations and urgent travel changes with the provider too.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button href={`mailto:${supportEmail}`}>Email support</Button>
            <Button href="/plan" tone="secondary">Plan another trip</Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
