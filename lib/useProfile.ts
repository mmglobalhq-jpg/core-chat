"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Profile = {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  email: string | null;
};

/**
 * The signed-in user's own profile fields (RLS: profiles_select_own). Works for
 * both regular users and the admin. `loading` is true until the first read
 * resolves; `profile` is null when signed out or the row is missing.
 */
export function useProfile(): { profile: Profile | null; loading: boolean } {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, username, email")
        .eq("id", session.user.id)
        .maybeSingle();
      if (active) {
        setProfile((data as Profile | null) ?? null);
        setLoading(false);
      }
    }
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void load());
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { profile, loading };
}
