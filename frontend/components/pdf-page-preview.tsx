"use client";

import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Skeleton } from "@/components/skeleton";
import { getDocumentFile } from "@/lib/api";

// Worker is served from a CDN that mirrors the installed pdf.js version.
// Avoids having to copy the worker file into /public during build.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Props = {
  documentId: number;
  pageNumber: number;
  width: number;
};

export function PdfPagePreview({ documentId, pageNumber, width }: Props) {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getDocumentFile(documentId)
      .then((buf) => {
        if (!cancelled) setData(buf);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "failed to load PDF");
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (error) {
    return (
      <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {error}
      </p>
    );
  }

  if (!data) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  return (
    <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-100">
      <Document
        file={data}
        loading={<Skeleton className="h-[400px] w-full" />}
        error={
          <p className="p-3 text-xs text-red-700 dark:text-red-400">
            Failed to render PDF.
          </p>
        }
      >
        <Page
          pageNumber={pageNumber}
          width={width}
          renderAnnotationLayer={false}
          renderTextLayer={false}
          loading={<Skeleton className="h-[400px] w-full" />}
        />
      </Document>
    </div>
  );
}
