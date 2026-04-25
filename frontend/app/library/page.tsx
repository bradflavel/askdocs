"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { UploadZone } from "@/components/upload-zone";
import {
  type DocumentOut,
  type DocumentStatus,
  clearToken,
  createConversation,
  listDocuments,
  uploadDocument,
} from "@/lib/api";

export default function LibraryPage() {
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const noChangeCountRef = useRef(0);
  const prevTerminalIdsRef = useRef<Set<number>>(new Set());

  const signOut = useCallback(() => {
    clearToken();
    router.push("/login");
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const list = await listDocuments();
      const terminalNow = new Set(
        list
          .filter((d) => d.status === "ready" || d.status === "failed")
          .map((d) => d.id),
      );
      const transitioned = [...terminalNow].some(
        (id) => !prevTerminalIdsRef.current.has(id),
      );
      noChangeCountRef.current = transitioned ? 0 : noChangeCountRef.current + 1;
      prevTerminalIdsRef.current = terminalNow;
      setDocs(list);
      setLoaded(true);
    } catch (err) {
      // 401s are handled centrally by AuthBouncer; surface anything else.
      toast.error(
        err instanceof Error ? err.message : "Failed to load documents",
      );
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hasNonTerminal = docs.some(
      (d) => d.status === "pending" || d.status === "processing",
    );
    if (!hasNonTerminal) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const intervalMs = () => {
      const c = noChangeCountRef.current;
      if (c >= 6) return 10000;
      if (c >= 3) return 5000;
      return 2000;
    };

    const schedule = () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        timer = null;
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) return;
        void refresh();
      }, intervalMs());
    };

    const onVisibilityChange = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        noChangeCountRef.current = 0;
        if (timer === null) void refresh();
      } else if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [docs, refresh]);

  async function onChat(documentId: number) {
    try {
      const conv = await createConversation(documentId);
      router.push(`/chat/${conv.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start chat");
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    setProgress(0);
    try {
      await uploadDocument(file, (loaded, total) => {
        setProgress(Math.round((loaded / total) * 100));
      });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Library</h1>
        <button onClick={signOut} className="text-sm text-neutral-600 underline">
          sign out
        </button>
      </header>

      <div className="mb-8">
        <UploadZone
          onFile={handleFile}
          progress={uploading ? progress : null}
          busy={uploading}
        />
      </div>

      {!loaded ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-16" />
            </li>
          ))}
        </ul>
      ) : docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-neutral-700">
            No documents yet
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Drop a PDF or DOCX above to start asking questions about it.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded border border-neutral-200 bg-white px-4 py-3"
            >
              <div>
                <div className="font-medium">{d.filename}</div>
                <div className="text-xs text-neutral-500">
                  {d.page_count ?? "?"} pages · uploaded{" "}
                  {new Date(d.uploaded_at).toLocaleString()}
                </div>
                {d.error && (
                  <div className="text-xs text-red-600">{d.error}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={d.status} />
                {d.status === "ready" && (
                  <button
                    onClick={() => onChat(d.id)}
                    className="rounded bg-neutral-900 px-3 py-1 text-xs text-white"
                  >
                    chat
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const classes: Record<DocumentStatus, string> = {
    pending: "bg-neutral-200 text-neutral-700",
    processing: "bg-blue-100 text-blue-700",
    ready: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded px-2 py-1 text-xs font-medium ${classes[status]}`}>
      {status}
    </span>
  );
}
