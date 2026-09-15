type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-[1.25rem] border border-[#e7dfd2] bg-[#fffdf8] p-5 shadow-[0_10px_28px_rgba(16,32,51,0.05)] ${className}`}>
      {children}
    </div>
  );
}
