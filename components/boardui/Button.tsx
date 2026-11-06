/**
 * BoardUI Button — Roamly port.
 *
 * Provenance: ported from BoardUI's `button` base component
 * (BoardUI/boardui, MIT; installed source inspected via
 * `npx boardui add button`). Structure kept: variants
 * primary/secondary/ghost/danger, sizes medium/small/xs, leading/
 * trailing icon slots rendered by the component, icon-only form,
 * Button / ButtonLink split.
 *
 * Adaptations for this tree: Tailwind v4 semantic classes
 * (bg-bg-primary …) re-expressed as Roamly token utilities (cblue/
 * cnavy/chead family); Remix icon dependency dropped — icon slots take
 * any component with a className prop (Lucide/Remix both fit);
 * motion uses the house easing + `.bui-press` tactile press; focus
 * ring uses the Roamly accent. No behaviour beyond BoardUI's own.
 */
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentType, ReactNode, Ref } from "react";
import { cx } from "./cx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "medium" | "small" | "xs";

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

type SharedProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  children?: ReactNode;
  className?: string;
  /**
   * In-flight state (owner vibe-tells checklist #2, 2026-11-03):
   * while an action is running, `busy` makes double-submit
   * impossible by default — the control disables (button) or
   * deactivates (link), shows a spinner, and sets aria-busy.
   * Contract: the caller sets busy on first tap/submit and clears
   * it only when the action settles.
   */
  busy?: boolean;
};

export interface BuiButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">, SharedProps {
  ref?: Ref<HTMLButtonElement>;
}

export interface BuiButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">, SharedProps {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-cblue text-white shadow-[0_8px_20px_rgba(8,123,255,0.25)] hover:bg-[#0A6FE0] focus-visible:ring-cblue/30",
  secondary:
    "border border-chair bg-white text-chead shadow-bui-card hover:border-cblue/50 hover:text-cblue focus-visible:ring-cblue/25",
  ghost: "bg-transparent text-cink hover:bg-csoft hover:text-chead focus-visible:ring-cblue/25",
  danger:
    "bg-cred text-white shadow-[0_8px_20px_rgba(233,79,103,0.22)] hover:bg-[#D63A55] focus-visible:ring-cred/30"
};

const sizeClasses: Record<ButtonSize, string> = {
  medium: "min-h-11 px-5 py-3 text-sm gap-2",
  small: "min-h-9 px-4 py-2 text-[0.8125rem] gap-1.5",
  xs: "min-h-7 px-3 py-1 text-xs gap-1"
};

const iconOnlySizeClasses: Record<ButtonSize, string> = {
  medium: "h-11 w-11",
  small: "h-9 w-9",
  xs: "h-7 w-7"
};

const iconSizeClasses: Record<ButtonSize, string> = {
  medium: "h-[18px] w-[18px]",
  small: "h-4 w-4",
  xs: "h-3.5 w-3.5"
};

function sharedClasses({ variant = "primary", size = "medium", iconOnly = false, busy = false, className }: SharedProps) {
  return cx(
    "bui-press bui-tap bui-touch inline-flex select-none items-center justify-center whitespace-nowrap rounded-xl font-semibold",
    iconOnly ? "bui-touch-square" : null,
    "transition-colors duration-200 ease-bui focus-visible:outline-none focus-visible:ring-4",
    "disabled:pointer-events-none disabled:opacity-60",
    busy ? "pointer-events-none opacity-80" : null,
    variantClasses[variant],
    iconOnly ? iconOnlySizeClasses[size] : sizeClasses[size],
    className
  );
}

function slotIcon(Icon: IconComponent | undefined, size: ButtonSize) {
  if (!Icon) return null;
  return <Icon aria-hidden="true" className={iconSizeClasses[size]} />;
}

function BusySpinner({ size }: { size: ButtonSize }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={cx("animate-spin", iconSizeClasses[size])}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10v4a6 6 0 0 1 6 6h4z" fill="currentColor" className="opacity-90" />
    </svg>
  );
}

export function BuiButton({ variant, size = "medium", iconOnly, leadingIcon, trailingIcon, children, className, busy = false, disabled, ...rest }: BuiButtonProps) {
  return (
    <button
      className={sharedClasses({ variant, size, iconOnly, busy, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <BusySpinner size={size} /> : slotIcon(leadingIcon, size)}
      {iconOnly ? null : children}
      {slotIcon(trailingIcon, size)}
    </button>
  );
}

export function BuiButtonLink({ variant, size = "medium", iconOnly, leadingIcon, trailingIcon, children, className, href, busy = false, ...rest }: BuiButtonLinkProps) {
  return (
    <Link
      href={href}
      className={sharedClasses({ variant, size, iconOnly, busy, className })}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      tabIndex={busy ? -1 : undefined}
      {...rest}
    >
      {busy ? <BusySpinner size={size} /> : slotIcon(leadingIcon, size)}
      {iconOnly ? null : children}
      {slotIcon(trailingIcon, size)}
    </Link>
  );
}
