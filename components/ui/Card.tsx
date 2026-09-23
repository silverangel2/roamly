type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`roamly-card rounded-2xl border border-cloud/90 bg-[#fffdf8] p-5 shadow-[0_10px_28px_rgba(16,32,51,0.05)] ${className}`}>
      {children}
    </div>
  );
}
