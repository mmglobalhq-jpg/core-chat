"use client";

/**
 * Settings overlay opened from the sidebar's Settings button. A right-side Sheet
 * (Dialog-based, accessible: focus trap, Esc/overlay close, built-in close button)
 * with two tabs: Profile (read-only fields from public.profiles) and Preferences
 * (theme selection). Works for every signed-in user — separate from the
 * admin-only /settings/admin page.
 */
import { useEffect, useState } from "react";
import { Check, Loader2, Settings, SlidersHorizontal, User } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/lib/useProfile";
import { cn } from "@/lib/utils";

type Tab = "profile" | "preferences";

export function SettingsModal() {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground"
        >
          <Settings className="size-4" />
          <span className="text-sm">Settings</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>

        <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-border p-2">
          <TabButton active={tab === "profile"} onClick={() => setTab("profile")} icon={<User className="size-4" />}>
            Profile
          </TabButton>
          <TabButton active={tab === "preferences"} onClick={() => setTab("preferences")} icon={<SlidersHorizontal className="size-4" />}>
            Preferences
          </TabButton>
        </div>

        <div className="p-4">{tab === "profile" ? <ProfileTab /> : <PreferencesTab />}</div>
      </SheetContent>
    </Sheet>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ProfileTab() {
  const { profile, loading } = useProfile();

  if (loading) {
    return (
      <div className="flex justify-center py-10" role="tabpanel">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const fields: [string, string | null | undefined][] = [
    ["First name", profile?.first_name],
    ["Last name", profile?.last_name],
    ["Username", profile?.username],
    ["Email", profile?.email],
  ];

  return (
    <dl className="space-y-3" role="tabpanel" aria-label="Profile">
      {fields.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
            {value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PreferencesTab() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options: [string, string][] = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["system", "System"],
  ];

  return (
    <div role="tabpanel" aria-label="Preferences" className="space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Theme</p>
        <p className="text-xs text-muted-foreground">Choose how Core Chat looks.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map(([value, label]) => {
          const active = mounted && theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={active}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-ring bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              {active && <Check className="size-3.5" />}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
