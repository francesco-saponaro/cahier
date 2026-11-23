import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Composer } from "../src/screens/chat/Composer";

describe("the composer", () => {
  test("sends a trimmed question on Enter, keeps Shift+Enter for a new line, and clears itself", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} busy={false} />);
    const box = screen.getByLabelText("Your question");
    await userEvent.type(box, "How many days{Shift>}{Enter}{/Shift}of leave?  ");
    expect(box).toHaveValue("How many days\nof leave?  ");
    await userEvent.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("How many days\nof leave?");
    expect(box).toHaveValue("");
  });

  test("an empty question is not sent; one over the limit is refused with the limit", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onSend).not.toHaveBeenCalled();
    const box = screen.getByLabelText("Your question");
    await userEvent.click(box);
    await userEvent.paste("x".repeat(4001));
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveAccessibleDescription(/At most 4,000 characters/);
  });

  test("while an answer streams the button is disabled", () => {
    render(<Composer onSend={vi.fn()} busy />);
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });
});
