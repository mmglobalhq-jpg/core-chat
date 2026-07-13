"use client";

/**
 * Settings overlay opened from the sidebar's Settings button. A right-side Sheet
 * (Dialog-based, accessible: focus trap, Esc/overlay close, built-in close button)
 * with two tabs: Profile (read-only fields from public.profiles) and Preferences
 * (theme selection). Works for every signed-in user — separate from the
 * admin-only /settings/admin page.
 */
import { useEffect, useState } from "react";
import { CalendarDays, Check, ExternalLink, Loader2, Monitor, Plug, Settings, SlidersHorizontal, User } from "lucide-react";
import { useTheme } from "next-themes";
import { supabase } from "@/lib/supabaseClient";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/lib/useProfile";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { cn } from "@/lib/utils";

type Tab = "profile" | "preferences" | "integrations" | "desktop";

export function SettingsModal() {
  const [tab, setTab] = useState<Tab>("profile");
  const isAdmin = useIsAdmin();

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
          <TabButton active={tab === "integrations"} onClick={() => setTab("integrations")} icon={<Plug className="size-4" />}>
            Integrations
          </TabButton>
          {/* Admin-only Desktop tab. */}
          {isAdmin && (
            <TabButton active={tab === "desktop"} onClick={() => setTab("desktop")} icon={<Monitor className="size-4" />}>
              Desktop
            </TabButton>
          )}
        </div>

        <div className="p-4">
          {tab === "preferences" ? (
            <PreferencesTab />
          ) : tab === "integrations" ? (
            <IntegrationsTab />
          ) : tab === "desktop" && isAdmin ? (
            <DesktopTab />
          ) : (
            <ProfileTab />
          )}
        </div>
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

/** fetch() with the signed-in user's Supabase access token as a Bearer header. */
async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
}

function IntegrationsTab() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const d = await (await authFetch("/api/integrations/google/status")).json();
      setConnected(!!d.connected);
      setEmail(d.email ?? null);
    } catch {
      /* leave as disconnected */
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function connect() {
    setBusy(true);
    try {
      const d = await (await authFetch("/api/integrations/google/connect")).json();
      if (d.url) {
        window.location.href = d.url; // hand off to Google's consent screen
        return;
      }
    } catch {
      /* fall through */
    }
    setBusy(false);
  }

  async function disconnect() {
    setBusy(true);
    try {
      await authFetch("/api/integrations/google/disconnect", { method: "POST" });
    } catch {
      /* best-effort */
    }
    await refresh();
    setBusy(false);
  }

  return (
    <div role="tabpanel" aria-label="Integrations" className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Google Calendar</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {loading
                ? "Checking connection…"
                : connected
                  ? `Connected${email ? ` as ${email}` : ""}`
                  : "View, create, and manage your events from chat."}
            </p>
          </div>
        </div>
        <div className="mt-3">
          {loading ? null : connected ? (
            <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Disconnect
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={connect} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Connect Google Calendar
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Connecting lets the assistant view and manage your Google Calendar events on your behalf. You
        can disconnect at any time, which also revokes this app&rsquo;s access.
      </p>
    </div>
  );
}

function DesktopTab() {
  return (
    <div role="tabpanel" aria-label="Desktop" className="space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 p-6 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Monitor className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Remote Desktop Portal</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Opens the Guacamole desktop gateway in a new tab, behind Cloudflare Access.
          </p>
        </div>
        <Button asChild size="lg">
          <a href="https://desktop.mmglobal.us" target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            Launch Remote Desktop Portal
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        You&rsquo;ll authenticate through Cloudflare Access before the desktop loads. Admin-only.
      </p>
    </div>
  );
}
