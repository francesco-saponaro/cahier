import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { VersionForm } from "../src/screens/agents/VersionForm";

const models = [
  { id: "small-4", name: "Small 4", contextTokens: 128000, enabled: true, prices: { input: 150, cached_input: 15, output: 600 } },
  { id: "mini-8b", name: "Mini 8B", contextTokens: 32000, enabled: true, prices: { input: 100, cached_input: 10, output: 300 } },
];
const libraries = [
  { id: "lib_handbook", name: "Handbook", visibility: "workspace" as const, ownerName: "Noor Haddad", indexedCount: 6, documentCount: 6 },
  { id: "lib_drafts", name: "Drafts", visibility: "private" as const, ownerName: "Léa Marchetti", indexedCount: 1, documentCount: 2 },
];

describe("the version form", () => {
  test("refuses an empty name and a context budget outside the model's range", async () => {
    const onSubmit = vi.fn();
    render(<VersionForm models={models} libraries={libraries} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Model"), "mini-8b");
    const budget = screen.getByLabelText("Context budget");
    await userEvent.clear(budget);
    await userEvent.type(budget, "40000");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/Required/);
    expect(budget).toHaveAccessibleDescription(/At most 32,000 tokens for Mini 8B/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("sends the fields with the libraries ticked", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<VersionForm models={models} libraries={libraries} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Name"), "Expenses helper");
    await userEvent.type(screen.getByLabelText("Instructions"), "Answer from the expenses page.");
    await userEvent.click(screen.getByLabelText(/Handbook/));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: "Expenses helper", description: "", instructions: "Answer from the expenses page.", modelId: "small-4", maxContextTokens: 8000, libraryIds: ["lib_handbook"] }));
  });

  test("the chosen model's price is shown per million tokens, as the price list says it", async () => {
    render(<VersionForm models={models} libraries={libraries} onSubmit={vi.fn()} />);
    expect(screen.getByText(/\$0\.15 per million input tokens/)).toBeInTheDocument();
  });
});
