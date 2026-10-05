import type { ReactNode } from "react";

export function PackageChangeRow({
  label,
  value,
  actionLabel,
  onOpen
}: {
  label: string;
  value: string;
  actionLabel: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={actionLabel}
      className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/80"
    >
      <span className="text-[0.9375rem] font-medium tracking-[-0.01em] text-ink">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-sm text-slate-500">
        <span className="truncate">{value}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M7.5 4.5 13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

export function PackageChangeForm({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  return (
    <div className="px-4 py-4">
      {children}
      <button type="button" onClick={onCancel} className="mt-4 text-sm font-medium text-slate-500">
        Cancel
      </button>
    </div>
  );
}

export const packageLabelClass = "text-[0.8125rem] font-medium text-slate-500";
export const packageFieldClass = "mt-1.5 min-h-11 w-full rounded-xl border border-[#e6dece] bg-white px-3 text-base font-medium text-ink outline-none focus:border-ocean/40";
export const packagePrimaryClass = "inline-flex min-h-11 items-center justify-center rounded-full bg-ocean px-4 text-sm font-semibold text-white disabled:opacity-60";
export const packageQuietClass = "inline-flex min-h-11 items-center justify-center px-2 text-sm font-medium text-slate-500 disabled:opacity-60";
