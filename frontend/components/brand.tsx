type Props = {
  size?: "sm" | "md" | "lg";
};

const sizeClass: Record<NonNullable<Props["size"]>, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-2xl",
};

/**
 * App brand mark used in the header and on the unauthenticated pages.
 * Just text for now; an inline SVG glyph could land alongside as a
 * Tier 2 polish item.
 */
export function Brand({ size = "md" }: Props) {
  return (
    <span
      className={`font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 ${sizeClass[size]}`}
    >
      AskDocs
    </span>
  );
}
