"use client";

/**
 * Settings entry point (bottom-left of the sidebar, above Sign out). Clicking it
 * opens a small popup MENU anchored bottom-left (Claude-style) listing the settings
 * sections — Profile, Integrations, and (admin-only) Desktop + Admin. Picking a
 * section opens a larger centered dialog with that section's content; Admin routes
 * to the /settings/admin page. Theme lives in the top-right toggle, not here.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  Monitor,
  Plug,
  Settings,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/lib/useProfile";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { supabase } from "@/lib/supabaseClient";

type Section = "profile" | "integrations" | "desktop";

const SECTION_META: Record<Section, { title: string; icon: React.ReactNode }> = {
  profile: { title: "Profile", icon: <User className="size-5 text-primary" /> },
  integrations: { title: "Integrations", icon: <Plug className="size-5 text-primary" /> },
  desktop: { title: "Desktop", icon: <Monitor className="size-5 text-primary" /> },
};

export function SettingsMenu() {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [section, setSection] = useState<Section | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start gap-2 text-sidebar-foreground"
          >
            <Settings className="size-4" />
            <span className="text-sm">Settings</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
          <DropdownMenuItem onClick={() => setSection("profile")}>
            <User className="size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSection("integrations")}>
            <Plug className="size-4" />
            Integrations
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onClick={() => setSection("desktop")}>
              <Monitor className="size-4" />
              Desktop
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings/admin")}>
                <ShieldCheck className="size-4" />
                Admin
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {section && <SettingsDialog section={section} onClose={() => setSection(null)} />}
    </>
  );
}

function SettingsDialog({ section, onClose }: { section: Section; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = SECTION_META[section];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            {meta.icon}
            <h2 className="text-base font-semibold text-foreground">{meta.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {section === "profile" ? (
            <ProfileSection />
          ) : section === "integrations" ? (
            <IntegrationsSection />
          ) : (
            <DesktopSection />
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const { profile, loading } = useProfile();
  if (loading) {
    return (
      <div className="flex justify-center py-10">
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
    <dl className="space-y-3">
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

function IntegrationsSection() {
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
        window.location.href = d.url;
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
    <div className="space-y-4">
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

function DesktopSection() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 p-6 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Monitor className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Remote Desktop Portal</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Opens the Guacamole desktop gateway in a new tab.
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
        Log in with your desktop credentials when it loads. Admin-only.
      </p>
    </div>
  );
}
