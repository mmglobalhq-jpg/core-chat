"use client";

import Link from "next/link";
import { PanelLeftClose, Plus, Settings, ShieldCheck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useChatStore } from "@/store/useChatStore";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({
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
          <SidebarBody onToggle={onToggle} showCollapse />
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
            <SidebarBody onToggle={onToggle} showCollapse={false} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarBody({
  onToggle,
  showCollapse,
}: {
  onToggle: () => void;
  showCollapse: boolean;
}) {
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const newConversation = useChatStore((s) => s.newConversation);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const isAdmin = useIsAdmin();

  // Only show conversations that have messages — a brand-new empty chat isn't
  // listed in history until the user sends something (mirrors Gemini).
  const history = conversations.filter((c) => c.messages.length > 0);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Top: New Chat pinned (FR-004). */}
      <div className="flex items-center gap-2 p-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1 justify-start gap-2 bg-sidebar-accent/40"
          onClick={newConversation}
        >
          <Plus className="size-4" />
          New Chat
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
        <div className="flex flex-col gap-0.5 py-1">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Recent
          </p>
          {history.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No conversations yet.
            </p>
          ) : (
            history.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => selectConversation(conversation.id)}
                className={cn(
                  "truncate rounded-lg px-2 py-2 text-left text-sm transition-colors",
                  conversation.id === activeConversationId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                )}
                aria-current={conversation.id === activeConversationId}
              >
                {conversation.title}
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Bottom: settings + theme toggle pinned (FR-004, FR-020). */}
      <div className="mt-auto border-t border-sidebar-border p-2">
        <ThemeToggle />
        {/* Admin panel — only for is_admin users (UX gate; routes enforce it too). */}
        {isAdmin && (
          <Button
            asChild
            variant="ghost"
            className="w-full justify-start gap-2 text-sidebar-foreground"
          >
            <Link href="/settings/admin">
              <ShieldCheck className="size-4" />
              <span className="text-sm">Admin</span>
            </Link>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground"
        >
          <Settings className="size-4" />
          <span className="text-sm">Settings</span>
        </Button>
      </div>
    </div>
  );
}
