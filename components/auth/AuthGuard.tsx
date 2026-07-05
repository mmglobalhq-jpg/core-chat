"use client";

/**
 * Client-side auth gate. Wraps the app in the root layout: any route other than
 * the public ones (currently just /login) requires a live Supabase session, and
 * an unauthenticated visitor is redirected to /login. An already-authenticated
 * user who lands on /login is bounced back to the app. Guarding here (rather than
 * per-page) keeps every future route protected by default without a redirect loop
 * on the login screen.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const PUBLIC_ROUTES = ["/login"];

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
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? "authed" : "anon");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (state === "anon" && !isPublic) router.replace("/login");
    if (state === "authed" && isPublic) router.replace("/");
  }, [state, isPublic, router]);

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
