import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { BudgetForm } from "../src/screens/admin/BudgetForm";
import { InviteForm } from "../src/screens/admin/InviteForm";
import { SettingsForm } from "../src/screens/admin/SettingsForm";

describe("the invite form", () => {
  test("needs an email address and sends it with the role", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<InviteForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Email"), "not-an-address");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(/Enter an email address/);
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.type(screen.getByLabelText("Email"), " Sam@Example.com ");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "admin");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ email: "Sam@Example.com", role: "admin" }));
  });
});

describe("the budget form", () => {
  test("reads dollars and sends micro-dollars for the month", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<BudgetForm month="2026-11" limitMicros={2_000_000} onSubmit={onSubmit} />);
    const limit = screen.getByLabelText("Limit for November 2026");
    expect(limit).toHaveValue("2.00");
    await userEvent.clear(limit);
    await userEvent.type(limit, "$1,250.50");
    await userEvent.click(screen.getByRole("button", { name: "Set the budget" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ month: "2026-11", limitMicros: 1_250_500_000 }));
  });

  test("refuses what is not an amount", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<BudgetForm month="2026-12" limitMicros={null} onSubmit={onSubmit} />);
    const limit = screen.getByLabelText("Limit for December 2026");
    expect(limit).toHaveValue("");
    await userEvent.type(limit, "ten");
    await userEvent.click(screen.getByRole("button", { name: "Set the budget" }));
    expect(limit).toHaveAccessibleDescription(/Write an amount in dollars/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("the settings form", () => {
  test("sends the tools as switched and the retention in its range", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<SettingsForm initial={{ tools: { groundedAnswers: true, scheduledPrompts: true, uploads: true }, retentionDays: 90 }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByLabelText("Scheduled prompts"));
    const retention = screen.getByLabelText("Keep archived conversations for");
    await userEvent.clear(retention);
    await userEvent.type(retention, "4000");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(retention).toHaveAccessibleDescription(/At most 3650/);
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.clear(retention);
    await userEvent.type(retention, "30");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ tools: { groundedAnswers: true, scheduledPrompts: false, uploads: true }, retentionDays: 30 }));
  });
});
