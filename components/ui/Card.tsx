type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-app border border-cloud bg-white/90 p-5 shadow-soft backdrop-blur ${className}`}>
      {children}
    </div>
  );
}
