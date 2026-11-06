"use client";

import { buildNavigationLinks, type NavigationDestination } from "@/lib/roamly/navigationLinks";
import { BuiButtonLink } from "@/components/boardui/Button";
import { useI18n } from "@/components/i18n/I18nProvider";

type NavigationButtonsProps = NavigationDestination & {
  tripId?: string;
  className?: string;
  showHeading?: boolean;
};

export function NavigationButtons({ tripId, className = "", showHeading = false, ...destination }: NavigationButtonsProps) {
  const { t } = useI18n();
  const links = buildNavigationLinks(destination);
  if (!links.length) return null;

  async function record(provider: string) {
    if (!tripId) return;
    await fetch("/api/roamly/navigation/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId,
        provider,
        destinationTitle: destination.destinationLabel || "Destination",
        destinationAddress: destination.address || ""
      })
    }).catch(() => undefined);
  }

  return (
    <div className={className}>
      {showHeading ? <p className="mb-2 text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.actions.directions")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <BuiButtonLink
            key={link.provider}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            onClick={() => void record(link.provider)}
            variant="secondary"
            size="small"
          >
            {link.label}
          </BuiButtonLink>
        ))}
      </div>
    </div>
  );
}
