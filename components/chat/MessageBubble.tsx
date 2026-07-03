"use client";

import { useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LoadingIndicator } from "@/components/chat/LoadingIndicator";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  /** True for the trailing assistant bubble while it is still streaming/empty. */
  loading?: boolean;
}

export function MessageBubble({ role, content, loading = false }: MessageBubbleProps) {
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
      {!isUser && (
        <Avatar className="mt-0.5 size-8 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}

      {/* User bubble is right-aligned: copy sits on its left (outer) edge. */}
      {isUser && copyButton}

      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {loading && content.length === 0 ? <LoadingIndicator /> : content}
      </div>

      {/* Assistant bubble is left-aligned: copy sits on its right (outer) edge. */}
      {!isUser && copyButton}
    </div>
  );
}
