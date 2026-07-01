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
}

export function Header({ onMenuClick, onToggleSidebar }: HeaderProps) {
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-3">
      {/* Mobile: open the sidebar sheet. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 md:hidden"
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

      {/* Borderless, minimalist model selector at top-left (FR-009, FR-010). */}
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
    </header>
  );
}
