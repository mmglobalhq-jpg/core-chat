"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/**
 * True when the signed-in user's own profile has is_admin = true. Reads the
 * caller's own row (RLS: profiles_select_own) and re-checks on auth changes.
 * UX-only — admin routes/actions are still enforced server-side.
 */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (active) setIsAdmin(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", session.user.id)
        .maybeSingle();
      if (active) setIsAdmin(!!(data as { is_admin?: boolean } | null)?.is_admin);
    }
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void check());
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return isAdmin;
}
