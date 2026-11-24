import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { JoinForm } from "../src/screens/sign-in/JoinForm";

describe("the join form", () => {
  test("needs the token, a name and a password that meets the rule", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<JoinForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Join the workspace" }));
    expect(screen.getByLabelText("Invitation token")).toHaveAccessibleDescription(/Required/);
    expect(screen.getByLabelText("Your name")).toHaveAccessibleDescription(/Required/);
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(/at least 10 characters/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("sends the trimmed token and name with the password as typed", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<JoinForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Invitation token"), " abc123token ");
    await userEvent.type(screen.getByLabelText("Your name"), "Sam Okafor");
    await userEvent.type(screen.getByLabelText("Password"), "a long enough password");
    await userEvent.click(screen.getByRole("button", { name: "Join the workspace" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ token: "abc123token", name: "Sam Okafor", password: "a long enough password" }));
  });
});
