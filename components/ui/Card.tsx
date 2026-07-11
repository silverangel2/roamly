type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-app border border-white/80 bg-white/88 p-5 shadow-soft backdrop-blur-xl ${className}`}>
      {children}
    </div>
  );
}
