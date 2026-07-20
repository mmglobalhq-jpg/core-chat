import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/";
const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: async () => ({}) } },
}));
vi.mock("@/store/useChatStore", () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      conversations: [],
      activeConversationId: null,
      newConversation: () => {},
      selectConversation: () => {},
      hideConversation: () => {},
    }),
}));
// Keep the test focused on the sidebar's own markup.
vi.mock("@/components/settings/SettingsMenu", () => ({ SettingsMenu: () => null }));
vi.mock("@/components/kb/KnowledgeBaseModal", () => ({ KnowledgeBaseModal: () => null }));

import { Sidebar } from "@/components/layout/Sidebar";

function renderSidebar() {
  return render(
    <Sidebar collapsed={false} onToggle={() => {}} mobileOpen={false} onMobileOpenChange={() => {}} />,
  );
}

beforeEach(() => {
  pathname = "/";
  push.mockReset();
  replace.mockReset();
});

describe("Sidebar Apps section", () => {
  it("has a REIT entry linking to /reits, alongside an intact Funds entry", () => {
    renderSidebar();
    const reit = screen.getByRole("link", { name: "REIT" });
    expect(reit).toHaveAttribute("href", "/reits");
    // Funds navigation is not renamed or removed.
    expect(screen.getByRole("link", { name: "Funds" })).toHaveAttribute("href", "/funds");
  });

  it("marks the REIT entry active only when on /reits", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "REIT" })).not.toHaveAttribute("aria-current", "page");

    pathname = "/reits";
    renderSidebar();
    const active = screen.getAllByRole("link", { name: "REIT" }).at(-1)!;
    expect(active).toHaveAttribute("aria-current", "page");
  });
});
