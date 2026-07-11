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
    "bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/20 hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400",
  secondary:
    "border border-slate-200 bg-white text-slate-700 shadow-soft hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700 hover:shadow-lg hover:shadow-cyan-500/10",
  ghost: "bg-transparent text-slate-700 hover:bg-cyan-50 hover:text-cyan-700"
};

const baseClass =
  "inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/30 disabled:pointer-events-none disabled:opacity-60";

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
