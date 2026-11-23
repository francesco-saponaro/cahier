import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { DocumentForm } from "../src/screens/libraries/DocumentForm";

describe("the document form", () => {
  test("refuses an empty text and a title over the limit before sending", async () => {
    const onSubmit = vi.fn();
    render(<DocumentForm mode="upload" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Title"), "x".repeat(81));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription(/At most 80 characters/);
    expect(screen.getByLabelText("Text")).toHaveAccessibleDescription(/Required/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a chosen text file fills the text and the title from its name", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<DocumentForm mode="upload" onSubmit={onSubmit} />);
    const file = new File(["# Hours\n\nWe open at nine."], "opening-hours.md", { type: "text/markdown" });
    await userEvent.upload(screen.getByLabelText("Or choose a file"), file);
    await waitFor(() => expect(screen.getByLabelText("Text")).toHaveValue("# Hours\n\nWe open at nine."));
    expect(screen.getByLabelText("Title")).toHaveValue("Opening hours");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(onSubmit).toHaveBeenCalledWith({ title: "Opening hours", text: "# Hours\n\nWe open at nine.", sourceName: "opening-hours.md" });
  });

  test("replacing starts from the current title and says what it does", async () => {
    const onSubmit = vi.fn(async () => "The library was removed.");
    render(<DocumentForm mode="replace" initialTitle="Leave and time off" onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Leave and time off");
    await userEvent.type(screen.getByLabelText("Text"), "New text.");
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The library was removed."));
    expect(onSubmit).toHaveBeenCalledWith({ title: "Leave and time off", text: "New text.", sourceName: undefined });
  });
});
