export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-card bg-panel ${className}`} aria-hidden />;
}
