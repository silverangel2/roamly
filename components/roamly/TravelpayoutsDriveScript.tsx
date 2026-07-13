import Script from "next/script";

const TRAVELPAYOUTS_DRIVE_SRC = "https://tp-em.com/NTQ5NzE1.js?t=549715";

const isTravelpayoutsDriveEnabled =
  process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_TRAVELPAYOUTS_DRIVE_ENABLED === "true";

export function TravelpayoutsDriveScript() {
  if (!isTravelpayoutsDriveEnabled) return null;

  return (
    <Script
      id="travelpayouts-drive"
      strategy="afterInteractive"
      src={TRAVELPAYOUTS_DRIVE_SRC}
      data-noptimize="1"
      data-cfasync="false"
      data-wpfc-render="false"
      seraph-accel-crit="1"
      data-no-defer="1"
    />
  );
}
