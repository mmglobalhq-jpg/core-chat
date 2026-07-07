"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useChatStore } from "@/store/useChatStore";

/**
 * Keeps the chat store's history in sync with the signed-in user. Hydrates once
 * on mount and again whenever the *user identity* changes (sign-in / sign-out) —
 * but NOT on routine TOKEN_REFRESHED events, which fire periodically and would
 * otherwise wipe an in-progress conversation. Mirrors the auth-subscription
 * pattern in useIsAdmin / useProfile.
 */
export function useChatSync(): void {
  const hydrate = useChatStore((s) => s.hydrateForUser);

  useEffect(() => {
    let mounted = true;
    // Tracks the last user id we hydrated for, so we only re-hydrate on a real
    // identity change. `undefined` = not yet known; `null` = signed out.
    let lastUid: string | null | undefined;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      lastUid = session?.user?.id ?? null;
      if (mounted) await hydrate();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      if (uid === lastUid) return; // token refresh / no-op — leave state alone
      lastUid = uid;
      void hydrate();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [hydrate]);
}
