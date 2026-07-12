"use client";

import { useEffect, useRef, useState } from "react";
import type { Message as UIMessage } from "ai";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { DocumentRow } from "@/lib/types";

interface ChatFeedProps {
  messages: UIMessage[];
  /** True while the newest assistant reply is still streaming in. */
  isStreaming?: boolean;
  /** Attached documents keyed by message id (rendered as chips on that message). */
  docsByMessage?: Record<string, DocumentRow[]>;
}

// Windowed rendering: only the most recent WINDOW messages are kept in the DOM;
// older ones load in chunks on demand. This bounds mount/update cost on long chats
// (a reopened 300-message conversation otherwise renders all 300 bubbles at once).
// The streaming tail is always inside the window, so autoscroll and the streaming
// `loading` flag are unaffected.
const WINDOW = 40;
const WINDOW_STEP = 40;

export function ChatFeed({
  messages,
  isStreaming = false,
  docsByMessage = {},
}: ChatFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(WINDOW);

  // Reset the window when the conversation changes (its first message id changes),
  // so reopening a long chat starts at the bottom rather than fully expanded.
  const conversationKey = messages[0]?.id;
  useEffect(() => {
    setVisibleCount(WINDOW);
  }, [conversationKey]);

  // Keep the latest message in view as new ones arrive (FR-015). Fires on
  // messages.length — not on "load earlier" (which only grows visibleCount), so
  // revealing older messages doesn't yank the view back to the bottom.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const isEmpty = messages.length === 0;
  const hasOlder = messages.length > visibleCount;
  // Always keep the tail (newest messages) rendered; drop the oldest beyond the window.
  const shown = hasOlder ? messages.slice(messages.length - visibleCount) : messages;

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
            {hasOlder && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setVisibleCount((n) => n + WINDOW_STEP)}
                  className="text-muted-foreground"
                >
                  Load earlier messages
                </Button>
              </div>
            )}
            {shown.map((message, index) =>
              message.role === "user" || message.role === "assistant" ? (
                <MessageBubble
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  docs={docsByMessage[message.id]}
                  loading={
                    isStreaming &&
                    index === shown.length - 1 &&
                    message.role === "assistant"
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
