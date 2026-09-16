type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`roamly-card rounded-[1.15rem] bg-[#fffdf8] p-5 ${className}`}>
      {children}
    </div>
  );
}
