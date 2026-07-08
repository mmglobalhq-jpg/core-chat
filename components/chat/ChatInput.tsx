"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DocChip } from "@/components/chat/DocChip";
import {
  createDocument,
  requestParse,
  setDocumentStatus,
  uploadOriginal,
} from "@/lib/documents";
import { useChatStore } from "@/store/useChatStore";
import { canSend } from "@/lib/mock-data";
import type { DocumentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_TEXTAREA_HEIGHT = 200;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB (matches the backend cap)
const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md,.markdown,.html,.htm,.ppt,.pptx,.json,.png,.jpg,.jpeg";

export interface PendingDoc {
  id: string;
  filename: string;
  contentType: string;
  status: DocumentStatus;
  error?: string;
}

interface ChatInputProps {
  /** Sends the message text plus any ready attachments. */
  onSend: (text: string, docs: PendingDoc[]) => void;
  isStreaming?: boolean;
  onStop?: () => void;
}

export function ChatInput({ onSend, isStreaming = false, onStop }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<PendingDoc[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploading = pending.some(
    (p) => p.status === "uploading" || p.status === "processing",
  );
  const sendable = canSend(value) && !uploading;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, [value]);

  function patch(id: string, update: Partial<PendingDoc>) {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...update } : p)));
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const convId = useChatStore.getState().activeConversationId;
    if (!convId) return;
    // A document's chat_id FK needs the chat row to exist before we insert it.
    await useChatStore.getState().ensureChatPersisted(convId);

    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      const contentType = file.type || "application/octet-stream";
      const base: PendingDoc = { id, filename: file.name, contentType, status: "uploading" };
      if (file.size > MAX_FILE_BYTES) {
        setPending((prev) => [...prev, { ...base, status: "error", error: "over 20 MB" }]);
        continue;
      }
      setPending((prev) => [...prev, base]);
      const created = await createDocument(id, convId, file.name, contentType, file.size);
      const uploaded = created ? await uploadOriginal(id, file) : false;
      if (!uploaded) {
        patch(id, { status: "error", error: "upload failed" });
        void setDocumentStatus(id, "error", "upload failed");
        continue;
      }
      patch(id, { status: "processing" });
      void setDocumentStatus(id, "processing");
      const res = await requestParse(id, file.name, contentType);
      patch(id, { status: res.status, error: res.error });
      void setDocumentStatus(id, res.status, res.error);
    }
  }

  function submit() {
    if (!sendable || isStreaming) return;
    onSend(
      value.trim(),
      pending.filter((p) => p.status === "ready"),
    );
    setValue("");
    setPending([]);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
      <div className="chat-bottom-fade pointer-events-none h-40 w-full" />
      <div className="pointer-events-auto absolute inset-x-0 bottom-4 flex justify-center px-4">
        <div className="flex w-full max-w-3xl flex-col gap-2 rounded-[1.75rem] border border-border bg-card px-2 py-2 shadow-lg">
          {/* Pending / attached document chips */}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pt-1">
              {pending.map((doc) => (
                <DocChip
                  key={doc.id}
                  filename={doc.filename}
                  status={doc.status}
                  onRemove={() =>
                    setPending((prev) => prev.filter((p) => p.id !== doc.id))
                  }
                />
              ))}
            </div>
          )}

          <div className="flex w-full items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Add attachment"
                  className="size-9 shrink-0 rounded-full"
                >
                  <Plus className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                  <Upload className="mr-2 size-4" />
                  Upload Docs
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={uploading ? "Processing document…" : "Message your assistant…"}
              aria-label="Message"
              className="max-h-[200px] min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />

            {isStreaming ? (
              <Button
                type="button"
                size="icon"
                onClick={onStop}
                aria-label="Stop generating"
                className={cn("size-9 shrink-0 rounded-full")}
              >
                <Square className="size-4 fill-current" />
              </Button>
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
