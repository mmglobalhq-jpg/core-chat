"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, PanelLeftClose, Plus, ShieldCheck, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { supabase } from "@/lib/supabaseClient";
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
  const hideConversation = useChatStore((s) => s.hideConversation);
  const isAdmin = useIsAdmin();
  const router = useRouter();

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
            history.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <div key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => selectConversation(conversation.id)}
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
                      "absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 group-hover:opacity-100",
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
        <SettingsModal />
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
