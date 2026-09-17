"use client";

/**
 * Knowledge chat: a conversation that answers ONLY from the user's knowledge base.
 *
 * Separate from the main assistant on purpose (platform doc 29): the main chat treated
 * the knowledge base as one source among twenty-odd tools and handled it badly. This
 * page talks to core-heartbeat's /kb/chat/stream, keeps its own history
 * (chats.kind = 'knowledge'), and has its library — add, replace, remove — beside the
 * chat instead of in a popup.
 *
 * Memory is per conversation only: each turn sends the prior turns, and each answer
 * carries the documents it cited so a follow-up resolves to the same document.
 *
 * Mobile rules from core-chat/CLAUDE.md apply: app-shell (not vh), safe-area insets,
 * 44pt targets, and the library's state lives in a store because the phone's Sheet
 * unmounts its children when it closes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message as UIMessage } from "ai";
import { Library, X } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { ChatInput } from "@/components/chat/ChatInput";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { KnowledgeLibrary } from "@/components/kb/KnowledgeLibrary";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SettingsPanel } from "@/components/settings/SettingsMenu";
import { useKnowledgeChatStore, shouldAutoTitle } from "@/store/useChatStore";
import { useChatSync } from "@/lib/useChatSync";
import { toolActivityLabel } from "@/lib/toolActivity";
import { generateTitle } from "@/lib/api";
import { sendKnowledgeChat, toKnowledgeHistory } from "@/lib/knowledgeApi";
import type { KnowledgeSource, Message } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY_MESSAGES: Message[] = [];

function maybeAutoTitle(conversationId: string) {
  const store = useKnowledgeChatStore.getState();
  const conversation = store.conversations.find((c) => c.id === conversationId);
  if (!conversation || !shouldAutoTitle(conversation)) return;
  const turns = conversation.messages.map((m) => ({ role: m.role, content: m.content }));
  void generateTitle(turns).then((title) => {
    if (title) useKnowledgeChatStore.getState().setConversationTitle(conversationId, title);
  });
}

function EmptyState({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Ask your knowledge base</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Answers come only from the documents you&rsquo;ve saved, with the passages they came from.
        If your documents don&rsquo;t cover something, it will say so.
      </p>
      <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={onOpenLibrary}>
        <Library className="size-4" />
        Manage documents
      </Button>
    </div>
  );
}

export default function KnowledgePage() {
  useChatSync(useKnowledgeChatStore);

  const activeConversationId = useKnowledgeChatStore((s) => s.activeConversationId);
  const activeMessages = useKnowledgeChatStore(
    (s) => s.conversations.find((c) => c.id === s.activeConversationId)?.messages ?? EMPTY_MESSAGES,
  );
  const messages = useMemo<UIMessage[]>(
    () => activeMessages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
    [activeMessages],
  );
  const sourcesByMessage = useMemo(() => {
    const out: Record<string, KnowledgeSource[]> = {};
    for (const m of activeMessages) if (m.sources?.length) out[m.id] = m.sources;
    return out;
  }, [activeMessages]);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Library: a side panel on desktop (open by default), a sheet on phones.
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [librarySheetOpen, setLibrarySheetOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [activeConversationId]);

  const openLibrary = useCallback(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setLibraryOpen(true);
    else setLibrarySheetOpen(true);
  }, []);

  const toggleLibrary = useCallback(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setLibraryOpen((o) => !o);
    else setLibrarySheetOpen(true);
  }, []);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleSend = useCallback(
    (text: string) => {
      const conversationId = activeConversationId;
      if (!conversationId) return;
      const store = useKnowledgeChatStore.getState();

      const history = toKnowledgeHistory(
        store.conversations.find((c) => c.id === conversationId)?.messages ?? [],
      );

      store.appendMessage(conversationId, {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      });
      const assistantId = crypto.randomUUID();
      store.beginAssistantMessage(conversationId, {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      });

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setActivity(null);

      let streamed = "";
      let rafId: number | null = null;
      const flush = () => {
        rafId = null;
        useKnowledgeChatStore.getState().patchMessageContent(conversationId, assistantId, streamed);
      };
      const finalize = (content: string, sources?: KnowledgeSource[]) => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        useKnowledgeChatStore
          .getState()
          .finalizeAssistantMessage(conversationId, assistantId, content, sources);
      };

      sendKnowledgeChat(
        text,
        history,
        conversationId,
        {
          onToken: (token) => {
            streamed += token;
            if (rafId === null) rafId = requestAnimationFrame(flush);
          },
          onActivity: (name) => setActivity(toolActivityLabel(name)),
        },
        controller.signal,
      )
        .then((result) => {
          finalize(
            streamed || result.reply || (result.status === "aborted" ? "⏹ Stopped." : "⚠️ No answer was produced. Try asking again."),
            result.sources,
          );
          maybeAutoTitle(conversationId);
        })
        .catch((err: unknown) => {
          finalize(
            controller.signal.aborted
              ? streamed || "⏹ Stopped."
              : `⚠️ Could not reach Knowledge chat: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
          setIsStreaming(false);
          setActivity(null);
        });
    },
    [activeConversationId],
  );

  return (
    <div className="app-shell flex w-full overflow-hidden bg-background">
      <div className="pt-safe fixed right-3 top-3 z-40">
        <ThemeToggle />
      </div>
      <Sidebar
        kind="knowledge"
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        <Header
          title="Knowledge"
          onMenuClick={() => setMobileOpen(true)}
          onToggleSidebar={() => setCollapsed((c) => !c)}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleLibrary}
              aria-label="Documents"
              aria-expanded={libraryOpen}
              className="min-h-11 gap-1.5 md:min-h-9"
            >
              <Library className="size-4" />
              <span className="hidden sm:inline">Documents</span>
            </Button>
          }
        />
        <main className="relative min-h-0 flex-1">
          <ChatFeed
            messages={messages}
            isStreaming={isStreaming}
            activity={activity}
            sourcesByMessage={sourcesByMessage}
            emptyState={<EmptyState onOpenLibrary={openLibrary} />}
          />
          <ChatInput
            onSend={(t) => handleSend(t)}
            isStreaming={isStreaming}
            onStop={handleStop}
            allowAttachments={false}
            placeholder="Ask about your documents…"
          />
        </main>
      </div>

      {/* Desktop library panel */}
      <aside
        aria-label="Documents"
        aria-hidden={!libraryOpen}
        className={cn(
          "hidden shrink-0 overflow-hidden border-l border-border bg-background transition-[width] duration-200 lg:block",
          libraryOpen ? "w-96" : "w-0 border-l-0",
        )}
      >
        <div className="pt-safe flex h-full w-96 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between px-4">
            <h2 className="text-base font-medium">Documents</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9"
              onClick={() => setLibraryOpen(false)}
              aria-label="Close documents"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">{libraryOpen && <KnowledgeLibrary />}</div>
        </div>
      </aside>

      {/* Phone / tablet library sheet */}
      <Sheet open={librarySheetOpen} onOpenChange={setLibrarySheetOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetHeader className="pt-safe border-b border-border">
            <SheetTitle>Documents</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <KnowledgeLibrary />
          </div>
        </SheetContent>
      </Sheet>

      <SettingsPanel />
    </div>
  );
}
