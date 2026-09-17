"use client";

import { Check, ChevronDown, Menu, PanelLeftOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/useChatStore";
import { MODEL_OPTIONS, modelLabel } from "@/lib/mock-data";

interface HeaderProps {
  onMenuClick: () => void;
  onToggleSidebar: () => void;
  /** Replaces the model selector with a fixed title (Knowledge chat has one model). */
  title?: string;
  /** Right-aligned controls, e.g. the Knowledge page's Library button. */
  actions?: React.ReactNode;
}

export function Header({ onMenuClick, onToggleSidebar, title, actions }: HeaderProps) {
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  return (
    <header className="pt-safe flex h-14 shrink-0 items-center gap-1 px-3">
      {/* Mobile: open the sidebar sheet. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 md:hidden"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </Button>

      {/* Desktop: expand the collapsed sidebar. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="hidden size-9 md:inline-flex"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeftOpen className="size-5" />
      </Button>

      {title ? (
        <h1 className="px-2.5 text-base font-medium">{title}</h1>
      ) : (
      /* Borderless, minimalist model selector at top-left (FR-009, FR-010). */
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="gap-1.5 px-2.5 text-base font-medium"
          >
            {modelLabel(selectedModelId)}
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {MODEL_OPTIONS.map((model) => (
            <DropdownMenuItem
              key={model.id}
              onSelect={() => setSelectedModel(model.id)}
              className="justify-between"
            >
              {model.label}
              {model.id === selectedModelId && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      )}
      {/* mr-12 keeps actions clear of the fixed theme toggle in the top-right corner. */}
      {actions && <div className="ml-auto mr-12 flex items-center gap-1">{actions}</div>}
    </header>
  );
}
