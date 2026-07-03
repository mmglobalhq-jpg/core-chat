"use client";

import { Sparkles } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { RouteMeta } from "@/lib/types";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  meta?: RouteMeta;
}

/** "local_llm" -> "Local LLM"; keeps LLM/API/ID acronyms uppercase. */
function prettyNode(node: string): string {
  const ACRONYMS = new Set(["llm", "api", "id"]);
  return node
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

function formatRoute(meta: RouteMeta): string {
  const path = [meta.model, ...meta.nodes.map(prettyNode)];
  return `[${path.join(" → ")}]`;
}

export function MessageBubble({ role, content, meta }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "flex w-full items-start gap-3",
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

      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-1",
          isUser ? "items-end" : "items-start",
        )}
      >
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

        {!isUser && meta && (
          <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
            {formatRoute(meta)}
          </span>
        )}
      </div>
    </div>
  );
}
