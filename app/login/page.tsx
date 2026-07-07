"use client";

/**
 * Production login view. Three sub-views inside one card (no separate modal):
 *   - signin: email + password (supabase.auth.signInWithPassword) with a magic
 *     link alternative (supabase.auth.signInWithOtp) and a "Forgot password?" link.
 *   - signup: email + password (supabase.auth.signUp).
 *   - forgot: email only (supabase.auth.resetPasswordForEmail) — sends a recovery
 *     link (via the project's custom SMTP) that lands on /reset-password.
 *
 * Returning tokens (magic-link + recovery hashes) are parsed by the browser
 * client (detectSessionInUrl) and routed by AuthGuard: a normal sign-in goes to
 * the dashboard "/", a PASSWORD_RECOVERY event goes to /reset-password.
 * Styling uses the shared design tokens, so light/dark mode both come for free.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

type View = "signin" | "signup" | "forgot";

// Where returning auth links land.
const dashboardUrl = () =>
  typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
const resetUrl = () =>
  typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;

const labelClass = "text-xs font-medium text-muted-foreground";
const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 " +
  "disabled:pointer-events-none disabled:opacity-50";

export default function LoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("signin");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchTo(next: View) {
    setView(next);
    setError(null);
    setNotice(null);
  }

  function guard<T extends (...args: never[]) => Promise<void>>(fn: T) {
    return async (...args: Parameters<T>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await fn(...args);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    };
  }

  const handlePassword = guard(async (e: React.FormEvent) => {
    e.preventDefault();
    if (view === "signup") {
      // Registration metadata rides in options.data -> auth.users.raw_user_meta_data,
      // which the handle_new_user() trigger copies into public.profiles.
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: dashboardUrl(),
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            username: username.trim(),
          },
        },
      });
      if (error) throw error;
      setNotice(
        "Account created. Confirm your email, then your registration goes to an " +
          "administrator for approval before access is granted.",
      );
      setView("signin");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/");
    }
  });

  const handleMagicLink = guard(async () => {
    if (!email.trim()) throw new Error("Enter your email first to receive a magic link.");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: dashboardUrl() },
    });
    if (error) throw error;
    setNotice(`Magic link sent to ${email}. Check your inbox to finish signing in.`);
  });

  const handleForgot = guard(async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetUrl(),
    });
    if (error) throw error;
    setNotice(`Password reset link sent to ${email}. Follow it to choose a new password.`);
  });

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Core Chat</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {view === "signin" && "Sign in to continue"}
              {view === "signup" && "Create your account"}
              {view === "forgot" && "Reset your password"}
            </p>
          </div>
        </div>

        {view === "forgot" ? (
          /* --- Forgot-password sub-view --------------------------------- */
          <form onSubmit={handleForgot} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="reset-email" className={labelClass}>Email</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className={inputClass}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Send reset link
            </Button>
            <button
              type="button"
              onClick={() => switchTo("signin")}
              className="mx-auto flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Back to sign in
            </button>
          </form>
        ) : (
          /* --- Sign in / Sign up ---------------------------------------- */
          <>
            <form onSubmit={handlePassword} className="space-y-3">
              {view === "signup" && (
                <>
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <label htmlFor="first-name" className={labelClass}>First name</label>
                      <input
                        id="first-name"
                        type="text"
                        autoComplete="given-name"
                        required
                        placeholder="Heath"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={busy}
                        className={inputClass}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label htmlFor="last-name" className={labelClass}>Last name</label>
                      <input
                        id="last-name"
                        type="text"
                        autoComplete="family-name"
                        required
                        placeholder="Maxwell"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={busy}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="username" className={labelClass}>Username</label>
                    <input
                      id="username"
                      type="text"
                      autoComplete="username"
                      required
                      placeholder="maxha"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={busy}
                      className={inputClass}
                    />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <label htmlFor="email" className={labelClass}>Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className={labelClass}>Password</label>
                  {view === "signin" && (
                    <button
                      type="button"
                      onClick={() => switchTo("forgot")}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete={view === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {view === "signin" ? "Sign in" : "Sign up"}
              </Button>
            </form>

            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={handleMagicLink}
            >
              Email me a magic link
            </Button>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {view === "signin" ? "No account yet?" : "Already have an account?"}{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-4"
                onClick={() => switchTo(view === "signin" ? "signup" : "signin")}
              >
                {view === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
