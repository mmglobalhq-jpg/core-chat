"use client";

/**
 * Client-side auth gate + returning-token interceptor. Wraps the app in the root
 * layout: protected routes require a live Supabase session (anonymous visitors go
 * to /login), while /login and /reset-password are public. It is also the auth
 * listener for returning tokens (parsed from the URL by detectSessionInUrl):
 *   - a normal SIGNED_IN (incl. magic-link) on /login is forwarded to the
 *     dashboard "/";
 *   - a PASSWORD_RECOVERY event is routed to /reset-password so the user can set
 *     a new password before entering the workspace.
 * Guarding here keeps every future route protected by default without a redirect
 * loop on the auth screens.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// Reachable without a session. /reset-password stays public so a recovery session
// is NOT bounced to the dashboard before the new password is set.
const PUBLIC_ROUTES = ["/login", "/reset-password"];

type AuthState = "loading" | "authed" | "anon";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<AuthState>("loading");

  const isPublic = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState(data.session ? "authed" : "anon");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      // A returning password-reset token: send the user to set a new password.
      if (event === "PASSWORD_RECOVERY") router.replace("/reset-password");
      setState(session ? "authed" : "anon");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    // Anonymous on a protected route -> sign in. Authenticated on /login (e.g. a
    // returning magic-link session) -> dashboard. /reset-password is intentionally
    // NOT auto-forwarded, so a recovery session can set its new password there.
    if (state === "anon" && !isPublic) router.replace("/login");
    if (state === "authed" && pathname === "/login") router.replace("/");
  }, [state, isPublic, pathname, router]);

  // Public routes render immediately (the login screen must be reachable).
  if (isPublic) return <>{children}</>;

  // Protected routes: hold the UI until we know the session, and while a redirect
  // to /login is in flight, so protected content never flashes for a signed-out user.
  if (state !== "authed") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return <>{children}</>;
}
