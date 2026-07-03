"use client";

import { useEffect, useRef } from "react";
import type { Message as UIMessage } from "ai";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "@/components/chat/MessageBubble";

interface ChatFeedProps {
  messages: UIMessage[];
  /** True while the newest assistant reply is still streaming in. */
  isStreaming?: boolean;
}

export function ChatFeed({ messages, isStreaming = false }: ChatFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as new ones arrive (FR-015).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const isEmpty = messages.length === 0;

  return (
    <ScrollArea className="h-full w-full">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-6 pb-44">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
            <h1 className="text-2xl font-semibold text-foreground">
              How can I help you today?
            </h1>
            <p className="text-sm text-muted-foreground">
              Start the conversation by typing a message below.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {messages.map((message, index) =>
              message.role === "user" || message.role === "assistant" ? (
                <MessageBubble
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  loading={
                    isStreaming &&
                    index === messages.length - 1 &&
                    message.role === "assistant" &&
                    message.content.length === 0
                  }
                />
              ) : null,
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
