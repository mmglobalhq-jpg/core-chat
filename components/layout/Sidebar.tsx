"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Building2,
  LogOut,
  MessageSquare,
  NotebookPen,
  PanelLeftClose,
  Plus,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { supabase } from "@/lib/supabaseClient";
import { useChatStore, useKnowledgeChatStore } from "@/store/useChatStore";
import type { ChatKind } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SidebarProps {
  /** Which chat's history this sidebar lists. Main chat by default. */
  kind?: ChatKind;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({
  kind = "main",
  collapsed,
  onToggle,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  return (
    <>
      {/* Desktop: persistent aside that collapses to reclaim chat space (FR-006). */}
      <aside
        className={cn(
          "hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-in-out md:block",
          collapsed ? "w-0 border-r-0" : "w-72",
        )}
        aria-hidden={collapsed}
      >
        <div className="flex h-full w-72 flex-col">
          <SidebarBody kind={kind} onToggle={onToggle} showCollapse />
        </div>
      </aside>

      {/* Mobile: same content inside a Sheet (FR-006). */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="w-72 bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <SidebarBody
              kind={kind}
              onToggle={onToggle}
              showCollapse={false}
              onDismiss={() => onMobileOpenChange(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarBody({
  kind,
  onDismiss,
  onToggle,
  showCollapse,
}: {
  kind: ChatKind;
  onToggle: () => void;
  showCollapse: boolean;

  /** Close the mobile drawer. Undefined on desktop, where there is none. */
  onDismiss?: () => void;
}) {
  // `kind` is fixed for the life of a page, so the hook choice is stable.
  const useStore = kind === "knowledge" ? useKnowledgeChatStore : useChatStore;
  const conversations = useStore((s) => s.conversations);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const newConversation = useStore((s) => s.newConversation);
  const selectConversation = useStore((s) => s.selectConversation);
  const hideConversation = useStore((s) => s.hideConversation);
  const router = useRouter();
  const pathname = usePathname();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login"); // AuthGuard also reacts to SIGNED_OUT; this is immediate.
  }

  // Show conversations that are persisted (loaded from Supabase) or that already
  // have messages. A brand-new empty chat isn't listed until the user sends
  // something (mirrors Gemini).
  const history = conversations.filter(
    (c) => c.persisted || c.messages.length > 0,
  );

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Chat switch: the main assistant and Knowledge chat are separate pages with
          separate histories. Links, so the URL is the state and Back works. */}
      <nav aria-label="Chats" className="px-3 pt-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-sidebar-accent/50 p-1">
          <ChatSwitchLink href="/" active={kind === "main"} icon={<MessageSquare className="size-4" />}>
            Chat
          </ChatSwitchLink>
          <ChatSwitchLink href="/knowledge" active={kind === "knowledge"} icon={<BookOpen className="size-4" />}>
            Knowledge
          </ChatSwitchLink>
        </div>
      </nav>

      {/* Top: New Chat pinned (FR-004). */}
      <div className="flex items-center gap-2 p-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1 justify-start gap-2 bg-sidebar-accent/40"
          onClick={() => {
            newConversation();
            onDismiss?.();
          }}
        >
          <Plus className="size-4" />
          {kind === "knowledge" ? "New Knowledge Chat" : "New Chat"}
        </Button>
        {showCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={onToggle}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>

      {/* Middle: scrollable history (FR-004). */}
      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="flex w-full min-w-0 flex-col gap-0.5 py-1">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Recent
          </p>
          {history.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No conversations yet.
            </p>
          ) : (
            history.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <div key={conversation.id} className="group relative w-full min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      selectConversation(conversation.id);
                      // Close the phone drawer on the user's choice. (It used to close on
                      // ANY active-conversation change, which includes history finishing
                      // loading — so a menu opened in the first second snapped shut.)
                      onDismiss?.();
                    }}
                    className={cn(
                      "w-full truncate rounded-lg py-2 pl-2 pr-9 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )}
                    aria-current={active}
                    title={conversation.title}
                  >
                    {conversation.title}
                  </button>
                  {/* Hover/focus-revealed "remove from Recent" (soft hide — the
                      conversation is kept in the DB). Always reachable via keyboard
                      focus for a11y / touch. One-click: hiding is non-destructive. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      hideConversation(conversation.id);
                    }}
                    aria-label={`Remove from Recent: ${conversation.title}`}
                    title="Remove from Recent"
                    className={cn(
                      // Always visible (subtle), brighter on hover/focus — chosen for
                      // discoverability; identical on mouse and touch. (Row clipping
                      // that hid this entirely is fixed in ScrollArea.)
                      "absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground hover:opacity-100 focus-visible:opacity-100",
                    )}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Apps: entry points to the app surfaces — its own box, above settings. */}
      <div className="mt-auto border-t border-sidebar-border p-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Apps</p>
        <Button
          asChild
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground"
        >
          <Link href="/funds">
            <BarChart3 className="size-4" />
            <span className="text-sm">Funds</span>
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2 text-sidebar-foreground",
            pathname === "/reits" && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
        >
          <Link href="/reits" aria-current={pathname === "/reits" ? "page" : undefined}>
            <Building2 className="size-4" />
            <span className="text-sm">REIT</span>
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2 text-sidebar-foreground",
            pathname === "/notes" && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
        >
          <Link href="/notes" aria-current={pathname === "/notes" ? "page" : undefined}>
            <NotebookPen className="size-4" />
            <span className="text-sm">Notes</span>
          </Link>
        </Button>
      </div>

      {/* Bottom: Settings (opens a bottom-left popup menu) + Sign out. */}
      <div className="border-t border-sidebar-border p-2">
        <SettingsMenu onOpenSection={onDismiss} />
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="size-4" />
          <span className="text-sm">Sign out</span>
        </Button>
      </div>
    </div>
  );
}

function ChatSwitchLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // min-h-11 on touch: the switch is the only way between the two chats.
        "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm transition-colors md:min-h-9",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar text-sidebar-foreground font-medium shadow-sm"
          : "text-muted-foreground hover:text-sidebar-foreground",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
