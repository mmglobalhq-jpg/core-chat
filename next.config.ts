import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server's /_next/* assets + HMR to be requested from the mini
  // PC's Tailscale IP (the laptop loads the UI cross-origin over the tailnet).
  allowedDevOrigins: ["100.120.201.126"],
};

export default nextConfig;
