"use client";

import { useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message as UIMessage } from "ai";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { ChatInput } from "@/components/chat/ChatInput";
import { useChatStore } from "@/store/useChatStore";
import { createId } from "@/lib/mock-data";
import { routeMessage, submitIntent } from "@/lib/router";
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
    async (text: string) => {
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

      // Local heuristic intent — still attached to the message (FR-026) and used
      // to populate the gateway payload's `intent` / `entities` fields.
      const localIntent = await routeMessage(text);
      attachIntent(conversationId, userMessage.id, localIntent);

      // Optimistic pending assistant bubble while the gateway call is in flight.
      const replyId = createId("assistant");
      setMessages((prev) => [...prev, { id: replyId, role: "assistant", content: "…" }]);

      // Real gateway call via the same-origin proxy (server-side -> backend).
      const reply = await submitIntent({
        intent: localIntent.primary_action,
        rawInput: text,
        modelPreference: selectedModelId,
        entities: localIntent.entities,
      });

      const assistant: Message = {
        id: replyId,
        role: "assistant",
        content: reply.text,
        createdAt: Date.now(),
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === replyId ? toUIMessage(assistant) : m)),
      );
      appendMessage(conversationId, assistant);
    },
    [activeConversationId, appendMessage, attachIntent, selectedModelId, setMessages],
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
          <ChatFeed messages={messages} />
          <ChatInput onSend={handleSend} />
        </main>
      </div>
    </div>
  );
}
