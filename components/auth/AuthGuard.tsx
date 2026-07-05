"use client";

/**
 * Client-side auth gate + returning-token interceptor + approval gate. Wraps the
 * app in the root layout:
 *   - /login and /reset-password are public.
 *   - protected routes require a live Supabase session; anonymous -> /login.
 *   - an authenticated user whose public.profiles.is_approved is false is blocked
 *     with the PendingApproval card instead of the dashboard.
 * It is also the returning-token listener: a magic-link SIGNED_IN on /login is
 * forwarded to "/", and a PASSWORD_RECOVERY event is routed to /reset-password.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { PendingApproval } from "@/components/auth/PendingApproval";

const PUBLIC_ROUTES = ["/login", "/reset-password"];

type Access = "loading" | "anon" | "pending" | "approved";

// Resolve the caller's access level: no session -> anon; otherwise read the
// user's own profile (RLS: profiles_select_own) and gate on is_approved.
async function resolveAccess(session: Session | null): Promise<Access> {
  if (!session) return "anon";
  const { data } = await supabase
    .from("profiles")
    .select("is_approved")
    .eq("id", session.user.id)
    .maybeSingle();
  return (data as { is_approved?: boolean } | null)?.is_approved ? "approved" : "pending";
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<Access>("loading");

  const isPublic = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const next = await resolveAccess(data.session);
      if (active) setState(next);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;
      // Returning password-reset token: go set a new password.
      if (event === "PASSWORD_RECOVERY") {
        router.replace("/reset-password");
        return;
      }
      const next = await resolveAccess(session);
      if (active) setState(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    // Anonymous on a protected route -> sign in. A signed-in user (approved OR
    // pending) on /login -> dashboard (where a pending user then sees the gate).
    if (state === "anon" && !isPublic) router.replace("/login");
    if ((state === "approved" || state === "pending") && pathname === "/login") {
      router.replace("/");
    }
  }, [state, isPublic, pathname, router]);

  // Public routes render immediately (auth screens must be reachable).
  if (isPublic) return <>{children}</>;

  // Hold the UI while resolving or redirecting a signed-out user.
  if (state === "loading" || state === "anon") {
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

  // Signed in but not yet approved -> block the dashboard.
  if (state === "pending") return <PendingApproval />;

  return <>{children}</>;
}
