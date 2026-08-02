type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-app border border-white/80 bg-white/88 p-5 shadow-soft backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88 dark:text-white ${className}`}>
      {children}
    </div>
  );
}
