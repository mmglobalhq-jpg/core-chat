"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message as UIMessage } from "ai";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { ChatInput } from "@/components/chat/ChatInput";
import { useChatStore } from "@/store/useChatStore";
import { createId } from "@/lib/mock-data";
import { routeMessage } from "@/lib/router";
import { sendChat } from "@/lib/api";
import type { Message } from "@/lib/types";

function toUIMessage(message: Message): UIMessage {
  return { id: message.id, role: message.role, content: message.content };
}

export default function Home() {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const attachIntent = useChatStore((s) => s.attachIntent);
  const selectedModelId = useChatStore((s) => s.selectedModelId);

  const { messages, setMessages } = useChat({
    id: activeConversationId ?? "new",
  });

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Tracks the in-flight streamed reply so the input can offer a Stop control
  // and so we can abort the fetch (and its downstream reader loop) on demand.
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Hydrate the feed from the store whenever the active conversation changes
  // (FR-007 clears, FR-008 loads). Intentionally keyed on the id only so live
  // sends within a conversation are not clobbered.
  useEffect(() => {
    const conversation = conversations.find(
      (c) => c.id === activeConversationId,
    );
    setMessages((conversation?.messages ?? []).map(toUIMessage));
    setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  const handleSend = useCallback(
    (text: string) => {
      const conversationId = activeConversationId;
      if (!conversationId) return;

      const userMessage: Message = {
        id: createId("user"),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, toUIMessage(userMessage)]);
      appendMessage(conversationId, userMessage);

      // Non-blocking intent routing (FR-026 / SC-008): fire-and-forget, attach
      // the payload when it resolves; a failure is inert (FR-028). Nothing here
      // is awaited, so the message + reply flow are never delayed by routing.
      routeMessage(text)
        .then((payload) =>
          attachIntent(conversationId, userMessage.id, payload),
        )
        .catch(() => {});

      // Live streamed reply from the backend gateway (via the /api/intent SSE
      // proxy). Append an empty assistant bubble immediately, then append each
      // token fragment to that message's content as it arrives. The finished
      // reply is persisted to the store once the stream completes; a failure
      // degrades the bubble to an inline error rather than throwing.
      const assistantId = createId("assistant");
      const patchContent = (content: string) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content } : m)),
        );

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      let streamed = "";
      sendChat(
        text,
        selectedModelId,
        (token) => {
          streamed += token;
          patchContent(streamed);
        },
        controller.signal,
      )
        .then((result) => {
          // No tokens streamed -> surface the status (degraded run) or a stop
          // notice instead of leaving a blank bubble.
          const content =
            streamed ||
            result.reply ||
            (result.status === "aborted"
              ? "⏹ Generation stopped."
              : `⚠️ No reply produced (status: ${result.status}).`);
          patchContent(content);
          appendMessage(conversationId, {
            id: assistantId,
            role: "assistant",
            content,
            createdAt: Date.now(),
          });
        })
        .catch((err: unknown) => {
          // A Stop before any response arrives rejects the fetch; that is a
          // clean cancellation, not a backend error.
          if (controller.signal.aborted) {
            const content = streamed || "⏹ Generation stopped.";
            patchContent(content);
            appendMessage(conversationId, {
              id: assistantId,
              role: "assistant",
              content,
              createdAt: Date.now(),
            });
            return;
          }
          const content = `⚠️ Could not reach the backend: ${
            err instanceof Error ? err.message : String(err)
          }`;
          patchContent(content);
          appendMessage(conversationId, {
            id: assistantId,
            role: "assistant",
            content,
            createdAt: Date.now(),
          });
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
          setIsStreaming(false);
        });
    },
    [activeConversationId, appendMessage, attachIntent, setMessages, selectedModelId],
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
