import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { translateExactText } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";

export default async function NotFound() {
  const locale = await getServerLocale();
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <BuiCard className="w-full max-w-lg p-5 text-center">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">404</p>
        <h1 className="mt-3 text-3xl font-black text-chead">{translateExactText(locale, "We couldn’t find that page.")}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-cink">
          {translateExactText(locale, "The link may be out of date, or the page may have moved. Start fresh or return to your trip.")}
        </p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <BuiButtonLink href="/">{translateExactText(locale, "Back home")}</BuiButtonLink>
          <BuiButtonLink href="/plan" variant="secondary">{translateExactText(locale, "Plan a trip")}</BuiButtonLink>
        </div>
      </BuiCard>
    </div>
  );
}
