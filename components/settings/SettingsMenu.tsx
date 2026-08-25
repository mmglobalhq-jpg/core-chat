"use client";

/**
 * Settings entry point (bottom-left of the sidebar, above Sign out). Clicking it
 * opens a small popup MENU anchored bottom-left (Claude-style) listing the settings
 * sections — Profile, Integrations, and (admin-only) Desktop + Admin. Picking a
 * section opens a larger centered dialog with that section's content; Admin routes
 * to the /settings/admin page. Theme lives in the top-right toggle, not here.
 */
import { cn } from "@/lib/utils";
import type { SettingsSection } from "@/store/useSettingsStore";
import { useSettingsStore } from "@/store/useSettingsStore";
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
  Upload,
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
import { FileUploadSection } from "@/components/settings/FileUploadSection";
import { supabase } from "@/lib/supabaseClient";

// The store owns this vocabulary. A local copy is how "briefing" survived in one place and
// not the other when the section was removed — the build caught it, but only at the very end.
type Section = SettingsSection;

const SECTION_META: Record<Section, { title: string; icon: React.ReactNode }> = {
  profile: { title: "Profile", icon: <User className="size-5 text-primary" /> },
  integrations: { title: "Integrations", icon: <Plug className="size-5 text-primary" /> },
  desktop: { title: "Desktop", icon: <Monitor className="size-5 text-primary" /> },
  files: { title: "File Upload", icon: <Upload className="size-5 text-primary" /> },
};

interface SettingsMenuProps {
  /** Fired when a settings section opens. The mobile sidebar uses this to close
   *  its drawer first, so the panel reads as a popup rather than a third layer
   *  stacked over an open sheet. */
  onOpenSection?: () => void;
}

export function SettingsMenu({ onOpenSection }: SettingsMenuProps = {}) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  // State lives in the store, not here: this component is inside the mobile Sheet,
  // which unmounts its children on close, so local state would be destroyed by the
  // very drawer-dismiss that is supposed to reveal the panel.
  const setSection = useSettingsStore((st) => st.openSection);

  const openSection = (next: Section) => {
    setSection(next);
    onOpenSection?.();
  };

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
          <DropdownMenuItem onClick={() => openSection("profile")}>
            <User className="size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openSection("integrations")}>
            <Plug className="size-4" />
            Integrations
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onClick={() => openSection("files")}>
              <Upload className="size-4" />
              File Upload
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem onClick={() => openSection("desktop")}>
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

    </>
  );
}

/**
 * The settings panel. Rendered by `app/page.tsx`, deliberately OUTSIDE the sidebar
 * so closing the mobile drawer cannot unmount it. Returns null when nothing is open.
 */
export function SettingsPanel() {
  const section = useSettingsStore((st) => st.section);
  const closeSection = useSettingsStore((st) => st.closeSection);
  if (!section) return null;
  return <SettingsDialog section={section} onClose={closeSection} />;
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
      // Bottom sheet on a phone, centred dialog from md up. A centred box is hard
      // to reach one-handed and leaves the on-screen keyboard overlapping it when a
      // field is focused; a sheet anchored to the bottom is the iOS convention.
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 flex w-full flex-col overflow-hidden border-border bg-background shadow-xl",
          // 85dvh, not 85vh: on iOS Safari vh includes the area behind the toolbars,
          // so the sheet would extend past the screen and clip its own content.
          "max-h-[85dvh] rounded-t-2xl border-x-0 border-b-0 border-t",
          "md:max-w-lg md:rounded-xl md:border",
        )}
      >
        {/* Grab handle: signals "drag/dismissable" and gives a bigger tap area
            above the content on touch. Decorative only. */}
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30 md:hidden" />
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            {meta.icon}
            <h2 className="text-base font-semibold text-foreground">{meta.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="size-5 md:size-4" />
          </button>
        </div>
        {/* pb-safe keeps the last control clear of the home indicator. */}
        <div className="overscroll-none-mobile overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {section === "profile" ? (
            <ProfileSection />
          ) : section === "integrations" ? (
            <IntegrationsSection />
          ) : section === "files" ? (
            <FileUploadSection />
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
