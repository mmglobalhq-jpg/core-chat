"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch: theme is only known on the client.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start gap-2 text-sidebar-foreground"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {mounted && isDark ? (
        <Moon className="size-4" />
      ) : (
        <Sun className="size-4" />
      )}
      <span className="text-sm">
        {mounted ? (isDark ? "Dark mode" : "Light mode") : "Theme"}
      </span>
    </Button>
  );
}
