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
    "bg-ocean text-white shadow-[0_8px_20px_rgba(27,154,170,0.18)] hover:bg-[#167f8d]",
  secondary:
    "border border-[#d9d1c4] bg-[#fffdf8] text-ink shadow-sm hover:border-ocean/50 hover:bg-white hover:text-ocean",
  ghost: "bg-transparent text-slate-700 hover:bg-white/70 hover:text-ocean"
};

const baseClass =
  "inline-flex min-h-11 min-w-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/25 disabled:pointer-events-none disabled:opacity-60";

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
