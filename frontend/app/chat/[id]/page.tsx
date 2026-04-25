"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { CitationPill } from "@/components/citation-pill";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Skeleton } from "@/components/skeleton";
import { SourcePanel } from "@/components/source-panel";
import { useToast } from "@/components/toast";
import {
  type Conversation,
  type Message,
  clearToken,
  deleteConversation,
  getMessages,
  listConversations,
  renameConversation,
  sendChat,
} from "@/lib/api";
import { remarkCitations } from "@/lib/citation-remark";
import { streamSSE } from "@/lib/sse";

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const conversationId = Number(params.id);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const signOut = useCallback(() => {
    clearToken();
    router.push("/login");
  }, [router]);

  const onCitationClick = useCallback((chunkId: number) => {
    setSelectedChunkId(chunkId);
  }, []);

  async function saveRename(id: number) {
    const next = editingTitle.trim();
    setEditingId(null);
    if (!next) return;
    try {
      await renameConversation(id, next);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    }
  }

  async function confirmDelete() {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    if (id === null) return;
    try {
      await deleteConversation(id);
      // Drop from the sidebar immediately so the deleted item doesn't
      // ghost during the navigation transition.
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationId) {
        const remaining = conversations.filter((c) => c.id !== id);
        if (remaining.length > 0) {
          router.push(`/chat/${remaining[0].id}`);
        } else {
          router.push("/library");
        }
      } else {
        await loadData();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const loadData = useCallback(async () => {
    try {
      const [convs, msgs] = await Promise.all([
        listConversations(),
        getMessages(conversationId),
      ]);
      setConversations(convs);
      setMessages(msgs);
      setLoaded(true);
    } catch (err) {
      // 401s are handled centrally by AuthBouncer; surface anything else.
      toast.error(
        err instanceof Error ? err.message : "Failed to load conversation",
      );
    }
  }, [conversationId, toast]);

  useEffect(() => {
    // Reset transient view state synchronously on conversation switch so
    // the previous conversation's transcript doesn't bleed into the new
    // one during the loadData round-trip.
    setMessages([]);
    setStreamedAnswer("");
    setError(null);
    setSelectedChunkId(null);
    setLoaded(false);
    loadData();
  }, [conversationId, loadData]);

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
          {!loaded &&
            Array.from({ length: 3 }).map((_, i) => (
              <li key={`sk-${i}`} className="px-2 py-2">
                <Skeleton className="h-4 w-full" />
              </li>
            ))}
          {loaded &&
            conversations.map((c) => {
            const isActive = c.id === conversationId;
            const isEditing = editingId === c.id;
            return (
              <li key={c.id} className="group relative">
                {isEditing ? (
                  <input
                    autoFocus
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => void saveRename(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRename(c.id);
                      else if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full rounded border border-neutral-400 bg-white px-2 py-2 text-sm"
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => router.push(`/chat/${c.id}`)}
                      className={`flex-1 truncate rounded px-2 py-2 text-left text-sm ${
                        isActive
                          ? "bg-neutral-900 text-white"
                          : "hover:bg-neutral-100"
                      }`}
                    >
                      {c.title ?? `Conversation ${c.id}`}
                    </button>
                    <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditingTitle(c.title ?? "");
                        }}
                        className="rounded px-1 py-1 text-xs text-neutral-500 hover:text-neutral-900"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => setPendingDeleteId(c.id)}
                        className="rounded px-1 py-1 text-xs text-neutral-500 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {loaded && conversations.length === 0 && (
            <li className="text-xs text-neutral-500">No conversations yet.</li>
          )}
        </ul>
        <button onClick={signOut} className="mt-4 text-xs text-neutral-500 underline">
          sign out
        </button>
      </aside>

      <section className="flex flex-1 flex-col">
        <div ref={transcriptRef} className="flex-1 space-y-4 overflow-y-auto p-6">
          {!loaded && (
            <>
              <div className="ml-auto max-w-2xl space-y-2 rounded-lg bg-neutral-200 px-4 py-3">
                <Skeleton className="h-3 w-32 bg-neutral-300" />
                <Skeleton className="h-4 w-64 bg-neutral-300" />
              </div>
              <div className="max-w-2xl space-y-2 rounded-lg border border-neutral-200 bg-white px-4 py-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </>
          )}
          {loaded &&
            messages.map((m, i) => (
              <MessageBubble
                key={`${m.id}-${i}`}
                role={m.role}
                content={m.content}
                citedChunkIds={m.cited_chunk_ids}
                onCitationClick={onCitationClick}
              />
            ))}
          {streaming && streamedAnswer && (
            <MessageBubble
              role="assistant"
              content={streamedAnswer}
              onCitationClick={onCitationClick}
            />
          )}
          {error && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {loaded && messages.length === 0 && !streaming && (
            <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-12 text-center">
              <p className="text-sm font-medium text-neutral-700">
                Ready when you are
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Ask a question about this document to get started.
              </p>
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

      <SourcePanel
        chunkId={selectedChunkId}
        onClose={() => setSelectedChunkId(null)}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this conversation?"
        body="This will permanently remove the conversation and all its messages."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </main>
  );
}

function MessageBubble({
  role,
  content,
  citedChunkIds = [],
  onCitationClick,
}: {
  role: "user" | "assistant";
  content: string;
  citedChunkIds?: number[];
  onCitationClick?: (chunkId: number) => void;
}) {
  const allowed = new Set(citedChunkIds);
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
      {role === "assistant" ? (
        <div className="space-y-2 text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkCitations(allowed)]}
            components={{
              a: ({ href, children, ...rest }) => {
                if (href?.startsWith("#chunk-") && onCitationClick) {
                  const id = Number(href.slice("#chunk-".length));
                  return <CitationPill chunkId={id} onSelect={onCitationClick} />;
                }
                return (
                  <a href={href} {...rest}>
                    {children}
                  </a>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="whitespace-pre-wrap">{content}</div>
      )}
    </div>
  );
}
