"use client";

import { Star } from "lucide-react";

/**
 * The assistant's SINGLE status icon: a centered star wrapped by a spinning
 * dotted ring while a reply is loading/streaming/processing, and a clean, static
 * star at rest. This is the only assistant icon — it replaces the former pairing
 * of a separate avatar sparkle + an in-bubble spinner (which rendered two icons
 * side-by-side during streaming).
 *
 * `loading` drives the ring: true → the circular loading dots spin; false → the
 * ring is gone and only the resting star remains.
 */
export function LoadingIndicator({ loading = true }: { loading?: boolean }) {
  return (
    <span
      role="status"
      aria-label={loading ? "Assistant is thinking" : "Assistant"}
      className="relative inline-flex size-6 items-center justify-center"
    >
      {/* Circular loading dots — only while streaming; removed at the resting state. */}
      {loading && (
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-dotted border-primary/40 border-t-primary" />
      )}
      {/* Star: always present. On its own (no ring) it is the clean resting state. */}
      <Star className="size-3 fill-primary text-primary" aria-hidden />
    </span>
  );
}
