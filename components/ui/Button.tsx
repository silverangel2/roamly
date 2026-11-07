import Link from "next/link";

type ButtonTone = "primary" | "secondary" | "ghost";

type ButtonProps = {
  href?: string;
  children: React.ReactNode;
  tone?: ButtonTone;
  className?: string;
  type?: "button" | "submit";
};

const toneClasses: Record<ButtonTone, string> = {
  primary:
    "bg-cblue text-white shadow-[0_8px_20px_rgba(8,123,255,0.18)] hover:bg-[#071E55]",
  secondary:
    "border border-[#d9d1c4] bg-[#fffdf8] text-ink shadow-sm hover:border-cblue/50 hover:bg-white hover:text-cblue",
  ghost: "bg-transparent text-slate-700 hover:bg-white/70 hover:text-cblue"
};

const baseClass =
  "inline-flex min-h-11 min-w-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25 disabled:pointer-events-none disabled:opacity-60";

export function Button({ href, children, tone = "primary", className = "", type = "button" }: ButtonProps) {
  const classes = `${baseClass} ${toneClasses[tone]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes}>
      {children}
    </button>
  );
}
