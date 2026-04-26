"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * Light/dark theme toggle. Uses next-themes for SSR-safe persistence
 * and applies the class on <html> via the ThemeProvider in layout.tsx.
 *
 * Renders a placeholder until mounted to avoid the hydration mismatch
 * that next-themes warns about — the server doesn't know the user's
 * preferred theme, so the initial render must match either light or
 * dark deterministically and then swap on mount.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-6 w-6" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded p-1 text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
    >
      {isDark ? "☀" : "☾"}
    </button>
  );
}
