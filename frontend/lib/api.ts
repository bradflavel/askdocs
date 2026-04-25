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

function notifyUnauthenticated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("askdocs:unauthenticated"));
  }
}

async function throwIfBad(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  if (res.status === 401) notifyUnauthenticated();
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

export async function uploadDocument(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/documents`);
    const token =
      typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("upload: invalid response"));
        }
        return;
      }
      if (xhr.status === 401) notifyUnauthenticated();
      let detail = `upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (body?.detail) detail = `upload: ${body.detail}`;
      } catch {
        // keep default
      }
      reject(new Error(detail));
    };

    xhr.onerror = () => reject(new Error("upload network error"));
    xhr.send(fd);
  });
}

export type Conversation = {
  id: number;
  document_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  cited_chunk_ids: number[];
  created_at: string;
};

export async function createConversation(documentId: number): Promise<Conversation> {
  const res = await apiFetch("/conversations", {
    method: "POST",
    body: JSON.stringify({ document_id: documentId }),
  });
  await throwIfBad(res, "create conversation");
  return res.json();
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await apiFetch("/conversations");
  await throwIfBad(res, "list conversations");
  return res.json();
}

export async function renameConversation(
  conversationId: number,
  title: string,
): Promise<Conversation> {
  const res = await apiFetch(`/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  await throwIfBad(res, "rename conversation");
  return res.json();
}

export async function deleteConversation(conversationId: number): Promise<void> {
  const res = await apiFetch(`/conversations/${conversationId}`, {
    method: "DELETE",
  });
  await throwIfBad(res, "delete conversation");
}

export async function getMessages(conversationId: number): Promise<Message[]> {
  const res = await apiFetch(`/conversations/${conversationId}/messages`);
  await throwIfBad(res, "load messages");
  return res.json();
}

export async function sendChat(
  conversationId: number,
  question: string,
): Promise<Response> {
  const res = await apiFetch("/chat", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, question }),
  });
  if (!res.ok) {
    await throwIfBad(res, "chat");
  }
  return res;
}

export type ChunkContent = {
  id: number;
  document_id: number;
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
};

export async function getChunk(chunkId: number): Promise<ChunkContent> {
  const res = await apiFetch(`/chunks/${chunkId}`);
  await throwIfBad(res, "load chunk");
  return res.json();
}
