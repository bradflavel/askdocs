const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOKEN_KEY = "askdocs_token";

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jsonBody = init.body && !(init.body instanceof FormData);
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...authHeader(),
      ...(jsonBody ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
  user: { id: number; email: string };
};

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export type DocumentOut = {
  id: number;
  filename: string;
  page_count: number | null;
  status: DocumentStatus;
  uploaded_at: string;
  error?: string | null;
};

export type UploadResponse = {
  id: number;
  status: DocumentStatus;
  duplicate: boolean;
};

async function throwIfBad(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  let detail = `${label} failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.detail) detail = `${label}: ${body.detail}`;
  } catch {
    // ignore
  }
  throw new Error(detail);
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await throwIfBad(res, "login");
  return res.json();
}

export async function register(email: string, password: string): Promise<void> {
  const res = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await throwIfBad(res, "register");
}

export async function listDocuments(): Promise<DocumentOut[]> {
  const res = await apiFetch("/documents");
  await throwIfBad(res, "list documents");
  return res.json();
}

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await apiFetch("/documents", { method: "POST", body: fd });
  await throwIfBad(res, "upload");
  return res.json();
}
