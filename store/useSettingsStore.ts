import { create } from "zustand";

export type SettingsSection = "profile" | "integrations" | "desktop" | "briefing";

/**
 * Which settings panel is open, held ABOVE the sidebar.
 *
 * The trigger lives in the sidebar, which on mobile is inside a Radix Sheet. That
 * Sheet unmounts its children when it closes (no `forceMount`), so state owned by
 * the trigger's component died the moment the drawer closed — the panel opened,
 * the drawer closed, and the panel went with it. Nothing rendered.
 *
 * Keeping it in a store lets the drawer close while the panel survives, and lets
 * `app/page.tsx` render the panel outside the Sheet subtree entirely.
 */
interface SettingsState {
  section: SettingsSection | null;
  openSection: (section: SettingsSection) => void;
  closeSection: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  section: null,
  openSection: (section) => set({ section }),
  closeSection: () => set({ section: null }),
}));
