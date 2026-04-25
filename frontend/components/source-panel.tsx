"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/skeleton";
import { type ChunkContent, getChunk } from "@/lib/api";

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
    <aside className="flex w-80 flex-col border-l border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-600">Source</h2>
        {chunkId !== null && (
          <button
            onClick={onClose}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            close
          </button>
        )}
      </div>
      {chunkId === null && (
        <p className="text-sm text-neutral-500">
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
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {chunk && !loading && !error && (
        <div className="flex-1 overflow-y-auto">
          <div className="mb-2 text-xs text-neutral-500">
            Chunk {chunk.id} · pages {chunk.page_start ?? "?"}–
            {chunk.page_end ?? "?"}
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
            {chunk.content}
          </div>
        </div>
      )}
    </aside>
  );
}
