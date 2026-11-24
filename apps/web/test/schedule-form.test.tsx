import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ScheduleForm } from "../src/screens/schedules/ScheduleForm";

const agents = [
  { id: "agt_handbook", name: "Handbook helper" },
  { id: "agt_ops", name: "Ops assistant" },
];

describe("the schedule form", () => {
  test("needs a name and a prompt, and a weekday once the cadence is weekly", async () => {
    const onSubmit = vi.fn();
    render(<ScheduleForm agents={agents} timezone="Europe/Paris" onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Repeats"), "weekly");
    await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/Required/);
    expect(screen.getByLabelText("Prompt")).toHaveAccessibleDescription(/Required/);
    expect(screen.getByLabelText("Weekday")).toHaveAccessibleDescription(/Pick a weekday/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("sends the cadence with the time as a minute of the day, in the person's zone", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<ScheduleForm agents={agents} timezone="Europe/Paris" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Name"), "Monday digest");
    await userEvent.selectOptions(screen.getByLabelText("Agent"), "agt_ops");
    await userEvent.type(screen.getByLabelText("Prompt"), "What changed in the runbooks this week?");
    await userEvent.selectOptions(screen.getByLabelText("Repeats"), "weekly");
    await userEvent.selectOptions(screen.getByLabelText("Weekday"), "1");
    const time = screen.getByLabelText("At");
    await userEvent.clear(time);
    await userEvent.type(time, "08:30");
    await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        agentId: "agt_ops",
        name: "Monday digest",
        prompt: "What changed in the runbooks this week?",
        cadence: "weekly",
        atMinute: 510,
        weekday: 1,
        dayOfMonth: null,
        timezone: "Europe/Paris",
      }),
    );
  });

  test("a monthly schedule needs a day from 1 to 28", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<ScheduleForm agents={agents} timezone="UTC" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Name"), "Month close");
    await userEvent.type(screen.getByLabelText("Prompt"), "Summarise the month.");
    await userEvent.selectOptions(screen.getByLabelText("Repeats"), "monthly");
    const day = screen.getByLabelText("Day of the month");
    await userEvent.clear(day);
    await userEvent.type(day, "31");
    await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    expect(day).toHaveAccessibleDescription(/At most 28/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
