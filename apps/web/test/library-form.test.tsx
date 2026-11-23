import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LibraryForm } from "../src/screens/libraries/LibraryForm";

describe("the library form", () => {
  test("needs a name and keeps the description under its limit", async () => {
    const onSubmit = vi.fn();
    render(<LibraryForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Description"), "y".repeat(501));
    await userEvent.click(screen.getByRole("button", { name: "Create library" }));
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/Required/);
    expect(screen.getByLabelText("Description")).toHaveAccessibleDescription(/At most 500 characters/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("edits start from the current values and send the trimmed ones", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<LibraryForm initial={{ name: "Runbooks", description: "How we run things." }} onSubmit={onSubmit} />);
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Runbooks");
    await userEvent.clear(name);
    await userEvent.type(name, "  Runbooks and checklists ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: "Runbooks and checklists", description: "How we run things." }));
  });
});
