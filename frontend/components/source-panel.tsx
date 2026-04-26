"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/skeleton";
import { type ChunkContent, getChunk } from "@/lib/api";

// react-pdf needs browser APIs; load it client-only to avoid SSR errors.
const PdfPagePreview = dynamic(
  () => import("@/components/pdf-page-preview").then((m) => m.PdfPagePreview),
  { ssr: false, loading: () => <Skeleton className="h-[400px] w-full" /> },
);

type Props = {
  chunkId: number | null;
  onClose: () => void;
};

export function SourcePanel({ chunkId, onClose }: Props) {
  const [chunk, setChunk] = useState<ChunkContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (chunkId === null) {
      setChunk(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getChunk(chunkId)
      .then((c) => {
        if (!cancelled) setChunk(c);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chunkId]);

  return (
    <aside className="flex w-96 flex-col border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">
          Source
        </h2>
        {chunkId !== null && (
          <button
            onClick={onClose}
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            close
          </button>
        )}
      </div>
      {chunkId === null && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Click a citation in an answer to see the source passage.
        </p>
      )}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {chunk && !loading && !error && (
        <div className="flex-1 space-y-3 overflow-y-auto">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {chunk.document_filename} · pages {chunk.page_start ?? "?"}–
            {chunk.page_end ?? "?"}
          </div>
          {chunk.document_filename.toLowerCase().endsWith(".pdf") &&
            chunk.page_start && (
              <PdfPagePreview
                documentId={chunk.document_id}
                pageNumber={chunk.page_start}
                width={336}
              />
            )}
          <div className="whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-2 text-sm leading-relaxed text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
            {chunk.content}
          </div>
        </div>
      )}
    </aside>
  );
}
