"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto mt-32 max-w-md px-4 text-center">
      <p className="text-sm font-mono text-neutral-500 dark:text-neutral-400">
        Something broke
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Unexpected error</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {error.message || "An unknown error occurred."}
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Try again
      </button>
    </main>
  );
}
