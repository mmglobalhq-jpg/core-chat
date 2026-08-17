/**
 * Notes page — the real sequence, not just the parts.
 *
 * core-chat/CLAUDE.md: "A green test suite is not a working feature," citing a
 * panel that passed build, typecheck and 196 tests while rendering nothing. So
 * these drive the actual UI: click New, type, watch it save, delete it.
 *
 * The library is mocked at the network boundary only (lib/notes), so the page's
 * own logic — debounce, flush-before-switch, the delete/save race — is really
 * executed. `fireEvent` rather than user-event, matching the reits/funds page
 * tests and avoiding a new dependency.
 *
 * Under fake timers the async `findBy*` helpers poll on the timers they are
 * meant to be controlling, so those tests settle the initial load with an
 * explicit `act` and then query synchronously.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const listNotes = vi.fn();
const createNote = vi.fn();
const saveNote = vi.fn();
const deleteNote = vi.fn();

vi.mock("@/lib/notes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notes")>("@/lib/notes");
  return {
    ...actual, // keep the real displayTitle/formatNoteDate/constants
    listNotes: () => listNotes(),
    createNote: () => createNote(),
    saveNote: (id: string, f: unknown) => saveNote(id, f),
    deleteNote: (id: string) => deleteNote(id),
  };
});

import NotesPage from "@/app/notes/page";

const NOTE = {
  id: "n1",
  title: "Groceries",
  body: "milk",
  created_at: "2026-08-16T12:00:00Z",
  updated_at: "2026-08-16T12:00:00Z",
};

/** Render and let the initial load settle. Safe under fake timers. */
async function renderSettled() {
  const view = render(<NotesPage />);
  await act(async () => {});
  return view;
}

/**
 * Open a note by clicking its list button.
 *
 * Anchored at the start of the accessible name: the row's delete button is
 * labelled "Delete <title>", so an unanchored match finds both and the click
 * would be ambiguous.
 */
async function open(title: string) {
  // `select` awaits a flush before setting state, so the resulting render
  // happens in a promise continuation that must be settled inside act.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title}`) }));
  });
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  listNotes.mockResolvedValue([NOTE]);
  saveNote.mockImplementation(async (id: string, f: { title: string; body: string }) => ({
    ...NOTE, id, ...f, updated_at: "2026-08-16T13:00:00Z",
  }));
  deleteNote.mockResolvedValue(undefined);
  createNote.mockResolvedValue({
    id: "n2", title: "", body: "",
    created_at: "2026-08-16T14:00:00Z", updated_at: "2026-08-16T14:00:00Z",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Notes page", () => {
  it("lists existing notes", async () => {
    render(<NotesPage />);
    expect(await screen.findByText("Groceries")).toBeInTheDocument();
  });

  it("tells a signed-out reader to sign in instead of showing an error", async () => {
    listNotes.mockResolvedValue(null);
    render(<NotesPage />);
    expect(await screen.findByText("Sign in to see your notes.")).toBeInTheDocument();
  });

  it("shows the empty state when there are no notes", async () => {
    listNotes.mockResolvedValue([]);
    render(<NotesPage />);
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument();
  });

  it("surfaces a load failure rather than an endless spinner", async () => {
    listNotes.mockRejectedValue(new Error("Could not load your notes"));
    render(<NotesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your notes");
  });

  it("creates a note and opens it for editing", async () => {
    await renderSettled();
    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    await act(async () => {});

    expect(createNote).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Note title")).toHaveValue("");
    expect(screen.getByLabelText("Note body")).toHaveValue("");
  });

  it("saves an edit after the debounce, not immediately", async () => {
    vi.useFakeTimers();
    await renderSettled();

    await open("Groceries");
    type("Note body", "milk and eggs");
    expect(saveNote).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote.mock.calls[0][1]).toEqual({ title: "Groceries", body: "milk and eggs" });
  });

  it("coalesces rapid edits into one write", async () => {
    vi.useFakeTimers();
    await renderSettled();

    await open("Groceries");
    type("Note body", "a");
    type("Note body", "ab");
    type("Note body", "abc");

    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote.mock.calls[0][1].body).toBe("abc");
  });

  it("flushes a pending edit before switching notes, so nothing is lost", async () => {
    vi.useFakeTimers();
    listNotes.mockResolvedValue([NOTE, { ...NOTE, id: "n9", title: "Other" }]);
    await renderSettled();

    await open("Groceries");
    type("Note body", "milk!");
    // Switch away before the debounce would have fired.
    await open("Other");

    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote.mock.calls[0][0]).toBe("n1");
    expect(saveNote.mock.calls[0][1].body).toBe("milk!");
  });

  it("deletes after confirmation and drops the note from the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Groceries" }));

    expect(deleteNote).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(screen.queryByText("Groceries")).not.toBeInTheDocument());
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Groceries" }));

    expect(deleteNote).not.toHaveBeenCalled();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("does not resurrect a deleted note via a queued save", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderSettled();

    await open("Groceries");
    type("Note body", "milkx"); // queues a save
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Groceries" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(deleteNote).toHaveBeenCalledWith("n1");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("shows the API's message when a save fails", async () => {
    vi.useFakeTimers();
    saveNote.mockRejectedValue(new Error("That note is too long to save."));
    await renderSettled();

    await open("Groceries");
    type("Note body", "x");
    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByRole("alert")).toHaveTextContent("That note is too long to save.");
  });
});
