"use client";

/**
 * Password-recovery landing. The reset email (sent by resetPasswordForEmail on
 * the login page) links here with a recovery token in the URL hash. The browser
 * client's detectSessionInUrl parses it into a temporary session and fires
 * PASSWORD_RECOVERY; this page then lets the user set a new password via
 * supabase.auth.updateUser({ password }) and forwards them into the dashboard.
 *
 * This route is public in AuthGuard (so the recovery session is not bounced
 * before the password is set); it uses the shared design tokens for light/dark.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 " +
  "disabled:pointer-events-none disabled:opacity-50";

type Status = "checking" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // A recovery session (from the URL hash) is required to update the password.
    supabase.auth.getSession().then(({ data }) => {
      if (active) setStatus(data.session ? "ready" : "invalid");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setStatus((s) => (s === "done" ? s : "ready"));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      window.setTimeout(() => router.replace("/"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === "invalid"
              ? "This reset link is invalid or has expired."
              : "Set a new password for your account."}
          </p>
        </div>

        {status === "done" ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CheckCircle2 className="size-8 text-primary" />
            <p className="text-sm text-muted-foreground">
              Password updated. Taking you to your workspace…
            </p>
          </div>
        ) : status === "invalid" ? (
          <Button size="lg" className="w-full" onClick={() => router.replace("/login")}>
            Back to sign in
          </Button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="new-password" className="text-xs font-medium text-muted-foreground">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || status === "checking"}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirm-password" className="text-xs font-medium text-muted-foreground">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy || status === "checking"}
                className={inputClass}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy || status === "checking"}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
