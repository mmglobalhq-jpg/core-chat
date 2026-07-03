"use client";

import { Star } from "lucide-react";

/**
 * Assistant "thinking" indicator: a dotted ring that spins around a fixed,
 * centered star. Shown while a reply is being generated but before (or between)
 * token fragments arrive. Pure Tailwind + a lucide star — no external asset.
 */
export function LoadingIndicator() {
  return (
    <span
      role="status"
      aria-label="Assistant is thinking"
      className="relative inline-flex size-6 items-center justify-center"
    >
      {/* Spiral spinning wheel: dotted outline, brighter top edge for motion cue. */}
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-dotted border-primary/40 border-t-primary" />
      {/* Fixed star, perfectly centered inside the ring (does not spin). */}
      <Star className="size-3 fill-primary text-primary" aria-hidden />
    </span>
  );
}
