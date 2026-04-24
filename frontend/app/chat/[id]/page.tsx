"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Conversation,
  type Message,
  clearToken,
  getMessages,
  listConversations,
  sendChat,
} from "@/lib/api";
import { streamSSE } from "@/lib/sse";

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conversationId = Number(params.id);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const signOut = useCallback(() => {
    clearToken();
    router.push("/login");
  }, [router]);

  const loadData = useCallback(async () => {
    try {
      const [convs, msgs] = await Promise.all([
        listConversations(),
        getMessages(conversationId),
      ]);
      setConversations(convs);
      setMessages(msgs);
    } catch {
      signOut();
    }
  }, [conversationId, signOut]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamedAnswer]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    setError(null);
    setStreaming(true);
    setStreamedAnswer("");

    const optimisticUser: Message = {
      id: -1,
      role: "user",
      content: q,
      cited_chunk_ids: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await sendChat(conversationId, q);
      for await (const frame of streamSSE(res)) {
        const payload = JSON.parse(frame.data);
        if (frame.event === "token") {
          setStreamedAnswer((prev) => prev + payload.text);
        } else if (frame.event === "error") {
          setError(payload.detail ?? "stream error");
          break;
        } else if (frame.event === "done") {
          await loadData();
          setStreamedAnswer("");
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "stream error");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <main className="flex h-screen">
      <aside className="flex w-72 flex-col border-r border-neutral-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-600">Conversations</h2>
          <button
            onClick={() => router.push("/library")}
            className="rounded bg-neutral-900 px-2 py-1 text-xs text-white"
          >
            new chat
          </button>
        </div>
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => router.push(`/chat/${c.id}`)}
                className={`w-full truncate rounded px-2 py-2 text-left text-sm ${
                  c.id === conversationId
                    ? "bg-neutral-900 text-white"
                    : "hover:bg-neutral-100"
                }`}
              >
                {c.title ?? `Conversation ${c.id}`}
              </button>
            </li>
          ))}
          {conversations.length === 0 && (
            <li className="text-xs text-neutral-500">No conversations yet.</li>
          )}
        </ul>
        <button onClick={signOut} className="mt-4 text-xs text-neutral-500 underline">
          sign out
        </button>
      </aside>

      <section className="flex flex-1 flex-col">
        <div ref={transcriptRef} className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.map((m, i) => (
            <MessageBubble key={`${m.id}-${i}`} role={m.role} content={m.content} />
          ))}
          {streaming && streamedAnswer && (
            <MessageBubble role="assistant" content={streamedAnswer} />
          )}
          {error && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {messages.length === 0 && !streaming && (
            <div className="text-sm text-neutral-500">
              Ask a question about this document to get started.
            </div>
          )}
        </div>
        <form onSubmit={onSubmit} className="border-t border-neutral-200 bg-white p-4">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ask a question about this document"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={streaming}
              className="flex-1 rounded border border-neutral-300 px-3 py-2"
            />
            <button
              type="submit"
              disabled={streaming || !question.trim()}
              className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
            >
              {streaming ? "..." : "ask"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function MessageBubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  return (
    <div
      className={`max-w-2xl rounded-lg px-4 py-3 ${
        role === "user"
          ? "ml-auto bg-neutral-900 text-white"
          : "border border-neutral-200 bg-white text-neutral-900"
      }`}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide opacity-60">
        {role}
      </div>
      <div className="whitespace-pre-wrap">{content}</div>
    </div>
  );
}
