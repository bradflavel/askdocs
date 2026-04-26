"use client";

type Props = {
  chunkId: number;
  onSelect: (chunkId: number) => void;
};

export function CitationPill({ chunkId, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(chunkId)}
      className="mx-0.5 inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:hover:bg-blue-800"
    >
      [{chunkId}]
    </button>
  );
}
