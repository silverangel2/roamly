type BadgeProps = {
  children: React.ReactNode;
  tone?: "ocean" | "sun" | "coral" | "ink";
};

const toneClasses = {
  ocean: "border-ocean/20 bg-ocean/10 text-ocean",
  sun: "border-sun/30 bg-sun/15 text-amber-700",
  coral: "border-coral/25 bg-coral/10 text-coral",
  ink: "border-ink/10 bg-ink/5 text-ink"
};

export function Badge({ children, tone = "ocean" }: BadgeProps) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}
