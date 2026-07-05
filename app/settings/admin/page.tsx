"use client";

/**
 * Admin control panel (/settings/admin). Client-gated for UX (non-admins see a
 * 403 card); the REAL enforcement is server-side in the /api/admin/* routes,
 * which verify the bearer token's email against ADMIN_EMAIL. Lists all profiles
 * and exposes Pause (login ban toggle), Delete (with confirm), and Reset Password
 * — each hitting a service-role route handler.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Pause, Play, ShieldAlert, Trash2, KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ADMIN_EMAIL } from "@/lib/constants";
import { Button } from "@/components/ui/button";

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  email: string | null;
  is_approved: boolean;
  is_admin: boolean;
  paused: boolean;
};

type Status = "checking" | "forbidden" | "ready";

export default function AdminPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [users, setUsers] = useState<Profile[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (tok: string) => {
    const res = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${tok}` } });
    if (res.status === 401 || res.status === 403) {
      setStatus("forbidden");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { users?: Profile[] };
    setUsers(data.users ?? []);
    setStatus("ready");
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      if (!s || (s.user.email ?? "").toLowerCase() !== ADMIN_EMAIL) {
        setStatus("forbidden");
        return;
      }
      setToken(s.access_token);
      void load(s.access_token);
    });
  }, [load]);

  async function act(path: string, body: Record<string, unknown>, opts?: { confirm?: string; success?: string }) {
    if (opts?.confirm && !window.confirm(opts.confirm)) return;
    if (!token) return;
    setError(null);
    setNotice(null);
    setBusyId((body.userId as string) ?? path);
    try {
      const res = await fetch(`/api/admin/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Action failed.");
        return;
      }
      if (opts?.success) setNotice(opts.success);
      await load(token);
    } finally {
      setBusyId(null);
    }
  }

  if (status === "checking") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-6" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">403 — Not authorized</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is restricted to administrators.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-background p-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">User administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} registered {users.length === 1 ? "account" : "accounts"}.
          </p>
        </header>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {notice && <p className="mb-4 text-sm text-muted-foreground">{notice}</p>}

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Username</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const self = (u.email ?? "").toLowerCase() === ADMIN_EMAIL;
                const rowBusy = busyId === u.id;
                return (
                  <tr key={u.id} className="align-middle">
                    <td className="px-4 py-3 text-foreground">
                      {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.username || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge on={u.is_approved} onLabel="Approved" offLabel="Pending" />
                        {u.is_admin && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Admin</span>}
                        {u.paused && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Paused</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={self || rowBusy}
                          onClick={() => act("pause", { userId: u.id, pause: !u.paused })}
                          aria-label={u.paused ? "Resume" : "Pause"}
                        >
                          {u.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                          {u.paused ? "Resume" : "Pause"}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={rowBusy}
                          onClick={() =>
                            act("reset-password", { email: u.email }, { success: `Recovery email sent to ${u.email}.` })
                          }
                        >
                          <KeyRound className="size-3.5" /> Reset
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={self || rowBusy}
                          onClick={() =>
                            act("delete", { userId: u.id }, {
                              confirm: `Permanently delete ${u.email}? This cannot be undone.`,
                            })
                          }
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Badge({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return on ? (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{onLabel}</span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{offLabel}</span>
  );
}
