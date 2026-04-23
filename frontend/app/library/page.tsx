"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DocumentOut,
  type DocumentStatus,
  clearToken,
  listDocuments,
  uploadDocument,
} from "@/lib/api";

export default function LibraryPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const signOut = useCallback(() => {
    clearToken();
    router.push("/login");
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const list = await listDocuments();
      setDocs(list);
    } catch {
      signOut();
    }
  }, [signOut]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hasNonTerminal = docs.some(
      (d) => d.status === "pending" || d.status === "processing",
    );
    if (!hasNonTerminal) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [docs, refresh]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
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

      <form onSubmit={onUpload} className="mb-8 flex gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2"
        />
        <button
          type="submit"
          disabled={uploading}
          className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {uploading ? "uploading..." : "upload"}
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

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
              {d.error && <div className="text-xs text-red-600">{d.error}</div>}
            </div>
            <StatusBadge status={d.status} />
          </li>
        ))}
        {docs.length === 0 && (
          <li className="text-sm text-neutral-500">No documents yet. Upload one above.</li>
        )}
      </ul>
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
