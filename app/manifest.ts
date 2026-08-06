import type { MetadataRoute } from "next";

/**
 * Web app manifest — what makes "Add to Home Screen" open standalone, with no
 * Safari address bar or tab strip. That framing is most of what separates this
 * from "a website on my phone".
 *
 * iOS additionally requires `appleWebApp` metadata (see app/layout.tsx); the
 * manifest alone is not enough there.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Core Chat",
    short_name: "Core Chat",
    description: "A personal AI assistant.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Same art declared maskable: the star is inset to ~60%, so Android's crop
      // can't clip it.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
