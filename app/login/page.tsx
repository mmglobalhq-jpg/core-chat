"use client";

/**
 * Supabase Auth login screen. Supports email/password (sign in + sign up) and a
 * passwordless magic link. A successful password sign-in fires
 * onAuthStateChange, which the AuthGuard observes to redirect into the app; we
 * also push to "/" explicitly for immediacy. Magic-link sign-in completes when
 * the emailed link returns to the app (detectSessionInUrl in supabaseClient).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

type Mode = "signin" | "signup";

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 " +
  "disabled:pointer-events-none disabled:opacity-50";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMagicLink() {
    if (!email.trim()) {
      setError("Enter your email first to receive a magic link.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options:
          typeof window !== "undefined"
            ? { emailRedirectTo: window.location.origin }
            : undefined,
      });
      if (error) throw error;
      setNotice(`Magic link sent to ${email}. Check your inbox to finish signing in.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the magic link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold">Core Chat</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-3">
          <input
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
          <input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className={inputClass}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {mode === "signin" ? "Sign in" : "Sign up"}
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
          {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-4"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
