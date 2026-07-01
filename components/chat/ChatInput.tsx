"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { canSend } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (text: string) => void;
}

const MAX_TEXTAREA_HEIGHT = 200;

export function ChatInput({ onSend }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendable = canSend(value);

  // Auto-grow the textarea up to a bounded max, then scroll internally (FR-019).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, [value]);

  function submit() {
    if (!sendable) return;
    onSend(value.trim());
    setValue("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
      {/* Fading gradient behind the floating input (Principle V). */}
      <div className="chat-bottom-fade pointer-events-none h-40 w-full" />
      <div className="pointer-events-auto absolute inset-x-0 bottom-4 flex justify-center px-4">
        <div className="flex w-full max-w-3xl items-end gap-2 rounded-[1.75rem] border border-border bg-card px-2 py-2 shadow-lg">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Add attachment"
            className="size-9 shrink-0 rounded-full"
          >
            <Plus className="size-5" />
          </Button>

          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Message your assistant…"
            aria-label="Message"
            className="max-h-[200px] min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />

          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!sendable}
            aria-label="Send message"
            className={cn("size-9 shrink-0 rounded-full")}
          >
            <ArrowUp className="size-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
