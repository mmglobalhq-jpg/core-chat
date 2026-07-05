"use client";

/**
 * Full-screen gate shown to an authenticated user whose public.profiles.is_approved
 * is still false. Blocks the dashboard until an administrator approves them. Uses
 * the shared design tokens, so it matches light/dark automatically.
 */
import { Clock, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

export function PendingApproval() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Clock className="size-6" />
        </span>
        <h1 className="text-lg font-semibold text-foreground">Pending approval</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your registration is currently pending administrator approval.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          You&rsquo;ll receive an email the moment your account is activated.
        </p>
        <Button
          variant="outline"
          size="lg"
          className="mt-6 w-full"
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}
