"use client";

import { useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message as UIMessage } from "ai";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { ChatInput } from "@/components/chat/ChatInput";
import { useChatStore } from "@/store/useChatStore";
import { createId, mockReply } from "@/lib/mock-data";
import { routeMessage } from "@/lib/router";
import type { Message } from "@/lib/types";

function toUIMessage(message: Message): UIMessage {
  return { id: message.id, role: message.role, content: message.content };
}

export default function Home() {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const attachIntent = useChatStore((s) => s.attachIntent);

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

      const reply = { ...mockReply(text), createdAt: Date.now() };
      // Small simulated delay so the reply reads as a response, not an echo.
      window.setTimeout(() => {
        setMessages((prev) => [...prev, toUIMessage(reply)]);
        appendMessage(conversationId, reply);
      }, 350);
    },
    [activeConversationId, appendMessage, attachIntent, setMessages],
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
