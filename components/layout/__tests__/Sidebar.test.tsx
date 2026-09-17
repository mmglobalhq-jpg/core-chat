import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

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
const storeState = (title: string) => ({
  conversations: [{ id: title, title, messages: [], updatedAt: 1, persisted: true }],
  activeConversationId: null,
  newConversation: () => {},
  selectConversation: () => {},
  hideConversation: () => {},
});
vi.mock("@/store/useChatStore", () => ({
  useChatStore: (sel: (s: unknown) => unknown) => sel(storeState("A main-chat conversation")),
  useKnowledgeChatStore: (sel: (s: unknown) => unknown) => sel(storeState("A knowledge conversation")),
}));
// Keep the test focused on the sidebar's own markup.
vi.mock("@/components/settings/SettingsMenu", () => ({ SettingsMenu: () => null }));

import { Sidebar } from "@/components/layout/Sidebar";

function renderSidebar(kind?: "main" | "knowledge") {
  return render(
    <Sidebar kind={kind} collapsed={false} onToggle={() => {}} mobileOpen={false} onMobileOpenChange={() => {}} />,
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

  it("has a Notes entry linking to /notes, without disturbing the others", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Notes" })).toHaveAttribute("href", "/notes");
    // The entries Notes was added alongside are all still present.
    expect(screen.getByRole("link", { name: "Funds" })).toHaveAttribute("href", "/funds");
    expect(screen.getByRole("link", { name: "REIT" })).toHaveAttribute("href", "/reits");
    // The Knowledge Base popup button is gone: the library lives on /knowledge now.
    expect(screen.queryByRole("button", { name: "Knowledge Base" })).not.toBeInTheDocument();
  });

  it("marks the Notes entry active only when on /notes", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Notes" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    pathname = "/notes";
    renderSidebar();
    const active = screen.getAllByRole("link", { name: "Notes" }).at(-1)!;
    expect(active).toHaveAttribute("aria-current", "page");
    // Being on /notes must not light up a sibling.
    expect(screen.getAllByRole("link", { name: "REIT" }).at(-1)!).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Sidebar chat switch", () => {
  it("links Chat to / and Knowledge to /knowledge, marking the current one", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "Chats" });
    const chat = within(nav).getByRole("link", { name: "Chat" });
    const knowledge = within(nav).getByRole("link", { name: "Knowledge" });
    expect(chat).toHaveAttribute("href", "/");
    expect(knowledge).toHaveAttribute("href", "/knowledge");
    expect(chat).toHaveAttribute("aria-current", "page");
    expect(knowledge).not.toHaveAttribute("aria-current");
  });

  it("lists only the history of the chat it belongs to", () => {
    const { unmount } = renderSidebar("main");
    expect(screen.getByText("A main-chat conversation")).toBeInTheDocument();
    expect(screen.queryByText("A knowledge conversation")).not.toBeInTheDocument();
    unmount();

    renderSidebar("knowledge");
    expect(screen.getByText("A knowledge conversation")).toBeInTheDocument();
    expect(screen.queryByText("A main-chat conversation")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Chats" });
    expect(within(nav).getByRole("link", { name: "Knowledge" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /New Knowledge Chat/ })).toBeInTheDocument();
  });
});

describe("Sidebar phone drawer", () => {
  it("closes when the user picks a conversation, not on its own", () => {
    const onMobileOpenChange = vi.fn();
    render(<Sidebar collapsed={false} onToggle={() => {}} mobileOpen onMobileOpenChange={onMobileOpenChange} />);
    expect(onMobileOpenChange).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "A main-chat conversation" }));
    expect(onMobileOpenChange).toHaveBeenCalledWith(false);
  });
});
