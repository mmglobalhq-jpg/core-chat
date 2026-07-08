"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LoadingIndicator } from "@/components/chat/LoadingIndicator";
import { DocChip } from "@/components/chat/DocChip";
import type { DocumentRow } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  /** Documents attached to this message (rendered as chips above the bubble). */
  docs?: DocumentRow[];
  /** True for the trailing assistant bubble while it is still streaming/empty. */
  loading?: boolean;
}

export function MessageBubble({
  role,
  content,
  docs,
  loading = false,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable or permission denied — fail silently.
    }
  }

  // Copy affordance: hidden until the row is hovered (or the button is focused
  // for keyboard users). Suppressed while there is nothing to copy.
  const copyButton =
    content.length > 0 && !loading ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy message"}
        className={cn(
          "size-7 shrink-0 self-end rounded-full text-muted-foreground",
          "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    ) : null;

  return (
    <div
      className={cn(
        "group flex w-full items-start gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {/* The assistant avatar IS the single status icon: the star spins with its
          loading ring while streaming, then settles to a static star at rest. */}
      {!isUser && (
        <Avatar className="mt-0.5 size-8 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary">
            <LoadingIndicator loading={loading} />
          </AvatarFallback>
        </Avatar>
      )}

      {/* User bubble is right-aligned: copy sits on its left (outer) edge. */}
      {isUser && copyButton}

      {/* Attachment chips (above the bubble) + the message text. No bubble during
          the initial thinking phase (empty content) — the animated avatar carries
          the indication. */}
      {(content.length > 0 || (docs && docs.length > 0)) && (
        <div
          className={cn(
            "flex max-w-[80%] flex-col gap-1.5",
            isUser ? "items-end" : "items-start",
          )}
        >
          {docs && docs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {docs.map((d) => (
                <DocChip key={d.id} filename={d.filename} status={d.status} />
              ))}
            </div>
          )}
          {content.length > 0 && (
            <div
              className={cn(
                "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                isUser
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-muted text-foreground",
              )}
            >
              {content}
            </div>
          )}
        </div>
      )}

      {/* Assistant bubble is left-aligned: copy sits on its right (outer) edge. */}
      {!isUser && copyButton}
    </div>
  );
}
