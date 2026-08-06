import { describe, it, expect, beforeEach } from "vitest";

import { useSettingsStore } from "@/store/useSettingsStore";

/**
 * Why this state is in a store rather than in the component that opens it.
 *
 * The Settings trigger lives in the sidebar. On mobile the sidebar renders inside
 * a Radix Sheet, which unmounts its children when it closes (no `forceMount`).
 * Opening a section also closes the drawer — so with the state owned by the
 * trigger's component, the drawer-dismiss destroyed the state that was supposed to
 * show the panel. Tapping Settings did nothing at all.
 *
 * These tests pin the property that makes the fix work: the selection survives
 * independently of whichever component set it.
 */
describe("settings section state", () => {
  beforeEach(() => {
    useSettingsStore.setState({ section: null });
  });

  it("starts closed", () => {
    expect(useSettingsStore.getState().section).toBeNull();
  });

  it("survives the component that opened it being torn down", () => {
    useSettingsStore.getState().openSection("integrations");
    // The mobile drawer closing unmounts the trigger. The store is unaffected,
    // which is the entire point — previously the panel vanished here.
    expect(useSettingsStore.getState().section).toBe("integrations");
  });

  it("closes explicitly", () => {
    useSettingsStore.getState().openSection("profile");
    useSettingsStore.getState().closeSection();
    expect(useSettingsStore.getState().section).toBeNull();
  });

  it("switching sections replaces rather than stacks", () => {
    useSettingsStore.getState().openSection("profile");
    useSettingsStore.getState().openSection("desktop");
    expect(useSettingsStore.getState().section).toBe("desktop");
  });
});
