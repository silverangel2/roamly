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
  primary: "bg-ink text-white shadow-soft hover:-translate-y-0.5 hover:bg-ocean",
  secondary: "bg-white text-ink shadow-soft ring-1 ring-cloud hover:-translate-y-0.5 hover:ring-ocean/30",
  ghost: "bg-transparent text-ink hover:bg-white/70"
};

const baseClass =
  "inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-black transition disabled:pointer-events-none disabled:opacity-60";

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
