import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto mt-32 max-w-md px-4 text-center">
      <p className="text-sm font-mono text-neutral-500 dark:text-neutral-400">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        The link you followed might be broken, or the page may have been moved.
      </p>
      <Link
        href="/library"
        className="mt-6 inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Back to library
      </Link>
    </main>
  );
}
