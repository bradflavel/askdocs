"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { clearToken } from "@/lib/api";

/**
 * Persistent top app bar shown on the authenticated pages (library + chat).
 * Brand on the left links back to /library; theme toggle and sign-out on
 * the right. Replaces the per-page sign-out + theme-toggle controls that
 * used to float in headers and sidebars.
 */
export function AppHeader() {
  const router = useRouter();

  const signOut = useCallback(() => {
    clearToken();
    router.push("/login");
  }, [router]);

  return (
    <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
      <Link
        href="/library"
        className="rounded transition-opacity hover:opacity-80"
      >
        <Brand />
      </Link>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <button
          onClick={signOut}
          className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          sign out
        </button>
      </div>
    </header>
  );
}
