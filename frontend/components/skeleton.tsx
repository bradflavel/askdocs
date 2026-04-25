type Props = {
  className?: string;
};

export function Skeleton({ className = "" }: Props) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded bg-neutral-200 ${className}`}
    />
  );
}
