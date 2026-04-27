"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/skeleton";
import { type Conversation, listConversations } from "@/lib/api";

const RECENT_LIMIT = 5;

/**
 * "Recent conversations" card list shown on the library page below the
 * documents list. Reads the user's conversations (already sorted by
 * updated_at desc on the server) and renders the top few with a quick
 * jump-to-chat affordance. Fills the empty space the library page used
 * to leave below the documents.
 */
export function RecentConversations() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then((convs) => {
        if (!cancelled) {
          setConversations(convs);
          setLoaded(true);
        }
      })
      .catch(() => {
        // Auth failures are handled centrally by AuthBouncer; nothing
        // useful to do here besides leaving the section empty.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loaded && conversations.length === 0) {
    return null;
  }

  const top = conversations.slice(0, RECENT_LIMIT);

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-semibold text-neutral-600 dark:text-neutral-400">
        Recent conversations
      </h2>
      {!loaded ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-3 w-32" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {top.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => router.push(`/chat/${c.id}`)}
                className="flex w-full items-center justify-between rounded border border-neutral-200 bg-white px-4 py-3 text-left transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {c.title ?? `Conversation ${c.id}`}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    updated {new Date(c.updated_at).toLocaleString()}
                  </div>
                </div>
                <span className="ml-3 text-neutral-400 dark:text-neutral-500">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
