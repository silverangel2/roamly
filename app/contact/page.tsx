import { ContactForm } from "@/components/contact/ContactForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getRoamlySupportEmail } from "@/lib/roamly/email";

export default function ContactPage() {
  const supportEmail = getRoamlySupportEmail();

  return (
    <main className="safe-bottom mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
        <Card className="self-start overflow-hidden">
          <Badge>Contact</Badge>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Need help with a trip?</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-600">
            Send the trip destination, account email, and a short description of what happened. Keep booking confirmations and urgent travel changes with the provider too.
          </p>
          <div className="mt-6 grid gap-3">
            <Button href={`mailto:${supportEmail}`}>Email support</Button>
            <Button href="/plan" tone="secondary">Plan another trip</Button>
          </div>
          <p className="mt-5 break-words text-sm font-black text-slate-600">{supportEmail}</p>
        </Card>

        <ContactForm supportEmail={supportEmail} />
      </div>
    </main>
  );
}
