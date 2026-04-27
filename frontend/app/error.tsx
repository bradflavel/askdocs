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
    // Detail is logged here for the developer console only — never
    // rendered, so we don't leak parser/SQL/upstream internals to users.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto mt-32 max-w-md px-4 text-center">
      <p className="text-sm font-mono text-neutral-500 dark:text-neutral-400">
        Something broke
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Unexpected error</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Something went wrong on our end. Try again, or refresh the page.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-neutral-400 dark:text-neutral-500">
          ref: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="mt-6 rounded bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Try again
      </button>
    </main>
  );
}
