"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { login, register, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await register(email, password);
      }
      const res = await login(email, password);
      setToken(res.access_token);
      router.push("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-4">
        <Brand />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-20">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <Brand size="lg" />
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Ask grounded questions about your documents.
              <br />
              Streamed answers with inline citations.
            </p>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <h1 className="mb-5 text-lg font-semibold">
              {mode === "login" ? "Sign in" : "Create your account"}
            </h1>
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                type="email"
                required
                placeholder="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              <input
                type="password"
                required
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {busy ? "..." : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
            <div className="mt-4 text-center text-sm text-neutral-600 dark:text-neutral-400">
              {mode === "login" ? "New here? " : "Already have an account? "}
              <button
                type="button"
                onClick={() =>
                  setMode(mode === "login" ? "register" : "login")
                }
                className="font-medium text-neutral-900 underline hover:no-underline dark:text-neutral-100"
              >
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
            A portfolio project by Brad Flavel ·{" "}
            <a
              href="https://github.com/bradflavel/askdocs"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              source on GitHub
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
