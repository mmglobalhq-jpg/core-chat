"use client";

import { useEffect } from "react";

/**
 * Keeps the app shell sized to what is actually VISIBLE on the device.
 *
 * Two iOS Safari behaviours break a fixed-height chat layout, and neither has a
 * pure-CSS fix that works today:
 *
 * 1. `100vh` counts the area behind the dynamic address/tab bars, so the layout is
 *    taller than the screen. With `overflow: hidden` on the body — which a chat
 *    shell needs — the bottom of the page is simply unreachable, taking the message
 *    input with it. `100dvh` fixes this and is the fallback below.
 *
 * 2. Opening the keyboard shrinks the VISUAL viewport but leaves the LAYOUT
 *    viewport (and `dvh`) unchanged, so an absolutely-positioned input stays where
 *    it was — behind the keyboard. Only `visualViewport` reports this.
 *
 * So `--app-height` tracks `visualViewport.height`: the shell shrinks when the
 * keyboard opens and the input rides up with it, with no per-component keyboard
 * logic. `--app-top` covers the case where Safari scrolls the layout viewport
 * under the keyboard rather than resizing it.
 *
 * Desktop is unaffected — there `visualViewport.height` is just the window height.
 */
export function ViewportFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // very old browsers keep the 100dvh fallback

    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      root.style.setProperty("--app-height", `${vv.height}px`);
      root.style.setProperty("--app-top", `${vv.offsetTop}px`);
    };

    // resize/scroll fire rapidly while the keyboard animates; coalesce to a frame.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-top");
    };
  }, []);

  return null;
}
