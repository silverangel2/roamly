"use client";

import { BuiButton } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";

type LocationPermissionCardProps = {
  onEnable: () => void;
  busy?: boolean;
  error?: string;
  compact?: boolean;
};

export function LocationPermissionCard({ onEnable, busy, error, compact }: LocationPermissionCardProps) {
  return (
    <BuiCard className={compact ? "bui-enter p-4" : "bui-enter p-5"}>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">Live trip sensing</p>
      <h3 className={compact ? "mt-1 text-lg font-black text-chead" : "mt-2 text-2xl font-black text-chead"}>
        Enable nearby trip help.
      </h3>
      <p className="mt-2 text-sm font-bold leading-6 text-cink">
        Roamly can show nearby activities from your locked itinerary when you arrive. Your location is only used for trip features.
        {" "}
        Keep Roamly open or launch it from your phone&apos;s Home Screen for the best trip help.
      </p>
      <BuiButton type="button" onClick={onEnable} busy={busy} className="mt-4 w-full">
        {busy ? "Checking location..." : "Enable trip sensing"}
      </BuiButton>
      {error ? <BuiNotice tone="error" title={error} className="mt-3" /> : null}
    </BuiCard>
  );
}
