"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message as UIMessage } from "ai";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { ChatInput } from "@/components/chat/ChatInput";
import { useChatStore, shouldAutoTitle } from "@/store/useChatStore";
import { useChatSync } from "@/lib/useChatSync";
import { createId } from "@/lib/mock-data";
import { sendChat, generateTitle } from "@/lib/api";
import type { Message } from "@/lib/types";

/**
 * After a reply lands, if the conversation just hit its 2nd exchange, ask the
 * backend (local model) for a topic title and apply it. Fire-and-forget and
 * best-effort — reads the latest store state and no-ops on any failure.
 */
function maybeAutoTitle(conversationId: string) {
  const store = useChatStore.getState();
  const conversation = store.conversations.find((c) => c.id === conversationId);
  if (!conversation || !shouldAutoTitle(conversation)) return;
  const turns = conversation.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  void generateTitle(turns).then((title) => {
    if (title) useChatStore.getState().setConversationTitle(conversationId, title);
  });
}

function toUIMessage(message: Message): UIMessage {
  return { id: message.id, role: message.role, content: message.content };
}

// Stable empty-array reference so the feed selector doesn't re-render when there
// is no active conversation (a fresh `[]` each call would break memoization).
const EMPTY_MESSAGES: Message[] = [];

export default function Home() {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const selectedModelId = useChatStore((s) => s.selectedModelId);

  // Load this user's persisted chats on mount + on sign-in/out (per-user history).
  useChatSync();

  // The feed is a pure projection of the active conversation's messages in the
  // store (single source of truth). Streaming writes into the store too, so a
  // conversation switch mid-stream can never orphan the in-flight reply (C-2),
  // and no reconciliation effect / dual-write is needed.
  const activeMessages = useChatStore(
    (s) =>
      s.conversations.find((c) => c.id === s.activeConversationId)?.messages ??
      EMPTY_MESSAGES,
  );
  const messages = useMemo(
    () => activeMessages.map(toUIMessage),
    [activeMessages],
  );

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Tracks the in-flight streamed reply so the input can offer a Stop control
  // and so we can abort the fetch (and its downstream reader loop) on demand.
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Close the mobile sidebar when switching conversations.
  useEffect(() => {
    setMobileOpen(false);
  }, [activeConversationId]);

  const handleSend = useCallback(
    (text: string) => {
      const conversationId = activeConversationId;
      if (!conversationId) return;
      const store = useChatStore.getState();

      // Prior, already-completed turns of THIS conversation — sent to the backend
      // so the agent has context when continuing a reopened (or live) chat.
      const priorHistory = (
        store.conversations.find((c) => c.id === conversationId)?.messages ?? []
      ).map((m) => ({ role: m.role, content: m.content }));

      // User turn: append + persist immediately (optimistic).
      store.appendMessage(conversationId, {
        id: createId("user"),
        role: "user",
        content: text,
        createdAt: Date.now(),
      });

      // Assistant turn: an empty placeholder in the store to stream into; patched
      // per token; finalized (final content + single persist) when the stream ends.
      const assistantId = createId("assistant");
      store.beginAssistantMessage(conversationId, {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      });

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      let streamed = "";
      const finalize = (content: string) =>
        useChatStore
          .getState()
          .finalizeAssistantMessage(conversationId, assistantId, content);

      sendChat(
        text,
        selectedModelId,
        (token) => {
          streamed += token;
          useChatStore
            .getState()
            .patchMessageContent(conversationId, assistantId, streamed);
        },
        controller.signal,
        priorHistory,
      )
        .then((result) => {
          finalize(
            streamed ||
              result.reply ||
              (result.status === "aborted"
                ? "⏹ Generation stopped."
                : `⚠️ No reply produced (status: ${result.status}).`),
          );
          maybeAutoTitle(conversationId);
        })
        .catch((err: unknown) => {
          // A Stop before any response arrives rejects the fetch — clean cancel.
          finalize(
            controller.signal.aborted
              ? streamed || "⏹ Generation stopped."
              : `⚠️ Could not reach the backend: ${
                  err instanceof Error ? err.message : String(err)
                }`,
          );
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
          setIsStreaming(false);
        });
    },
    [activeConversationId, selectedModelId],
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        <Header
          onMenuClick={() => setMobileOpen(true)}
          onToggleSidebar={() => setCollapsed((c) => !c)}
        />
        <main className="relative min-h-0 flex-1">
          <ChatFeed messages={messages} isStreaming={isStreaming} />
          <ChatInput
            onSend={handleSend}
            isStreaming={isStreaming}
            onStop={handleStop}
          />
        </main>
      </div>
    </div>
  );
}
