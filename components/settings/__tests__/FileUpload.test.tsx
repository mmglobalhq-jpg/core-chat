import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// vi.mock factories are hoisted above ordinary top-level consts, so the mocks they
// close over have to be hoisted too.
const h = vi.hoisted(() => ({
  isAdmin: true,
  uploadToMiniPc: vi.fn(),
  listUploads: vi.fn(),
  deleteUpload: vi.fn(),
}));
const { uploadToMiniPc, listUploads, deleteUpload } = h;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/useIsAdmin", () => ({ useIsAdmin: () => h.isAdmin }));
vi.mock("@/lib/useProfile", () => ({ useProfile: () => ({ profile: null, loading: false }) }));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock("@/lib/uploads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/uploads")>("@/lib/uploads");
  return {
    ...actual,
    uploadToMiniPc: h.uploadToMiniPc,
    listUploads: h.listUploads,
    deleteUpload: h.deleteUpload,
  };
});

import { SettingsMenu, SettingsPanel } from "@/components/settings/SettingsMenu";
import { FileUploadSection } from "@/components/settings/FileUploadSection";
import { useSettingsStore } from "@/store/useSettingsStore";


/** Radix opens the menu on pointerdown, which jsdom does not implement usefully
 *  (no PointerEvent, no pointer capture). The keyboard path is a real user path
 *  and works, so drive that instead of faking pointer internals. */
function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /settings/i }), { key: "Enter" });
}

/** jsdom won't let a FileList be assigned normally. */
function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

beforeEach(() => {
  h.isAdmin = true;
  uploadToMiniPc.mockReset();
  deleteUpload.mockReset().mockResolvedValue(true);
  listUploads.mockReset().mockResolvedValue([]);
  useSettingsStore.setState({ section: null });
});

describe("the Settings menu entry", () => {
  it("offers File Upload to an admin", async () => {
    render(<SettingsMenu />);
    openMenu();
    expect(await screen.findByText("File Upload")).toBeInTheDocument();
  });

  it("hides File Upload from a non-admin", async () => {
    h.isAdmin = false;
    render(<SettingsMenu />);
    openMenu();
    await screen.findByText("Profile");
    expect(screen.queryByText("File Upload")).not.toBeInTheDocument();
  });

  // The regression this platform actually had: a settings panel that passed every
  // test while rendering nothing. Drive the real sequence — click the menu item,
  // then assert the panel content is on screen.
  it("opens a panel that actually renders when the item is picked", async () => {
    render(
      <>
        <SettingsMenu />
        <SettingsPanel />
      </>,
    );
    openMenu();
    fireEvent.click(await screen.findByText("File Upload"));
    expect(await screen.findByRole("dialog", { name: "File Upload" })).toBeInTheDocument();
    expect(screen.getByText(/Send files to the mini PC/i)).toBeInTheDocument();
  });
});

describe("FileUploadSection", () => {
  it("lists what is already on the mini PC, including hand-dropped files", async () => {
    listUploads.mockResolvedValue([
      { name: "dropped-by-hand.xlsx", size_bytes: 2048, modified: 1_700_000_000 },
    ]);
    render(<FileUploadSection />);
    expect(await screen.findByText("dropped-by-hand.xlsx")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("uploads a chosen file and refreshes the listing", async () => {
    uploadToMiniPc.mockResolvedValue({
      ok: true,
      stored: {
        stored_as: "notes.txt",
        original_name: "notes.txt",
        rewritten: false,
        size_bytes: 5,
        windows_path: "C:\\Users\\MMGlobal\\Uploads\\notes.txt",
      },
    });
    const { container } = render(<FileUploadSection />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    choose(input, new File(["hello"], "notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(uploadToMiniPc).toHaveBeenCalledOnce());
    expect(listUploads).toHaveBeenCalledTimes(2); // mount + post-upload refresh
  });

  it("says so when Windows forced a rename, rather than silently storing another name", async () => {
    uploadToMiniPc.mockResolvedValue({
      ok: true,
      stored: {
        stored_as: "CON_file.txt",
        original_name: "CON.txt",
        rewritten: true,
        size_bytes: 5,
        windows_path: "C:\\Users\\MMGlobal\\Uploads\\CON_file.txt",
      },
    });
    const { container } = render(<FileUploadSection />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    choose(input, new File(["hello"], "CON.txt", { type: "text/plain" }));
    expect(await screen.findByText("CON_file.txt")).toBeInTheDocument();
  });

  it("surfaces an upload failure on the file's row", async () => {
    uploadToMiniPc.mockResolvedValue({ ok: false, error: "file exceeds the 100 MB limit" });
    const { container } = render(<FileUploadSection />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    choose(input, new File(["x"], "big.bin"));
    expect(await screen.findByText("file exceeds the 100 MB limit")).toBeInTheDocument();
  });

  it("requires a confirmation before deleting a file", async () => {
    listUploads.mockResolvedValue([{ name: "gone.txt", size_bytes: 10, modified: 1 }]);
    render(<FileUploadSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete gone.txt" }));
    expect(deleteUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteUpload).toHaveBeenCalledWith("gone.txt"));
  });
});
