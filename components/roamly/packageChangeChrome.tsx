import type { InputHTMLAttributes, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BuiButton } from "@/components/boardui/Button";
import { BuiFieldError, type BuiField } from "@/components/boardui/Field";

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
      className="bui-press flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
    >
      <span className="text-[0.9375rem] font-medium tracking-[-0.01em] text-ink">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-sm text-cgray">
        <span className="truncate">{value}</span>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-cgray2" strokeWidth={1.8} />
      </span>
    </button>
  );
}

export function PackageChangeForm({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  return (
    <div className="px-4 py-4">
      {children}
      <BuiButton variant="ghost" onClick={onCancel} className="mt-4">
        Cancel
      </BuiButton>
    </div>
  );
}

// BoardUI field recipe (batch 4): the label style and input classes
// are the same strings the BoardUI form fields render (batch 3's
// BookingField in the manual booking form), so the package-change
// forms read exactly like the other BoardUI forms.
export const packageLabelClass = "block text-sm font-black text-chead";
export const packageFieldClass = "bui-input mt-2 w-full rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10";

/**
 * One validated package-change field, wired exactly like batch 3's
 * BookingField: the form owns the value state and the useBuiField
 * validation state; this renders the visible label, the input (blur
 * validates, keystrokes re-check once an error has shown), and the
 * always-rendered BuiFieldError slot under the field — the reserved
 * space means an error appearing never moves the submit button.
 * Callers key the field by `field.shakeKey` so a new error shakes.
 */
export function PackageField({
  id,
  label,
  value,
  onChange,
  field,
  type = "text",
  inputMode,
  min
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  field: BuiField;
  type?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  min?: number;
}) {
  return (
    <label className={field.shakeKey > 0 ? "bui-shake block" : "block"}>
      <span className="text-sm font-black text-chead">{label}</span>
      <input
        id={id}
        value={value}
        type={type}
        inputMode={inputMode}
        min={min}
        onChange={(event) => {
          onChange(event.target.value);
          field.onChange(event.target.value);
        }}
        onBlur={() => field.onBlur(value)}
        aria-invalid={field.error ? true : undefined}
        aria-describedby={field.error ? `${id}-error` : undefined}
        className={`bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
          field.error ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"
        }`}
      />
      <BuiFieldError id={`${id}-error`} message={field.error} />
    </label>
  );
}
