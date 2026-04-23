"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-6 text-2xl font-semibold">
        {mode === "login" ? "Sign in" : "Create account"}
      </h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-neutral-300 px-3 py-2"
        />
        <input
          type="password"
          required
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-neutral-300 px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {busy ? "..." : mode === "login" ? "Sign in" : "Register"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
        className="mt-4 text-sm text-neutral-600 underline"
      >
        {mode === "login" ? "need an account?" : "have an account?"}
      </button>
    </main>
  );
}
