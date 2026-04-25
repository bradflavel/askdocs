"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { clearToken } from "@/lib/api";

/**
 * Listens for the global 'askdocs:unauthenticated' event that the API
 * client dispatches on a 401 response, clears the token, and redirects
 * to /login. Mount once at the app root.
 */
export function AuthBouncer() {
  const router = useRouter();
  useEffect(() => {
    function onUnauthenticated() {
      clearToken();
      router.push("/login");
    }
    window.addEventListener("askdocs:unauthenticated", onUnauthenticated);
    return () =>
      window.removeEventListener("askdocs:unauthenticated", onUnauthenticated);
  }, [router]);
  return null;
}
