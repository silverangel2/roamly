type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`roamly-card rounded-[1.15rem] border border-[#e7dfd2] bg-[#fffdf8] p-5 shadow-[0_8px_22px_rgba(16,32,51,0.04)] ${className}`}>
      {children}
    </div>
  );
}
