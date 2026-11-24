import { expect, test } from "@playwright/test";
import { ask, go, signIn, signOut } from "./helpers";

/*
 * Tom builds an agent over the shared handbook, publishes it and asks to share it with the
 * workspace; Noor, the admin, reads what it would expose and approves; Léa then picks it for a
 * new conversation and gets a cited answer from it. Three people, one database in the page.
 */
test("an agent is built, shared with approval, and used by a colleague", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, "tom@example.com");

  // Tom: a new agent that reads the Handbook, saved as version 1 and published.
  await go(page, "Agents");
  await page.getByRole("link", { name: "New agent" }).click();
  await page.getByLabel("Name").fill("Expenses helper");
  await page.getByLabel("Description").fill("Answers expense questions from the handbook.");
  await page.getByLabel("Instructions").fill("Answer from the expenses policy only.");
  await page.getByRole("checkbox", { name: /^Handbook/ }).check();
  await page.getByRole("button", { name: "Create as a draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Expenses helper" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/version 1 answering/)).toBeVisible();
  await page.getByRole("button", { name: "Share with the workspace" }).click();
  await expect(page.getByRole("button", { name: "Withdraw the share request" })).toBeVisible();
  await signOut(page);

  // Noor: the request is in the inbox with what it exposes; approve it.
  await signIn(page, "noor@example.com");
  await go(page, "Admin");
  await page.getByRole("link", { name: "Share inbox" }).click();
  const row = page.getByRole("row", { name: /Expenses helper/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Tom Delaunay");
  await expect(row).toContainText("Handbook");
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("row", { name: /Expenses helper/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Agents shared with the workspace" }).locator("..").locator("..")).toContainText("Expenses helper");
  await signOut(page);

  // Léa: the agent is offered for a new conversation and answers with a citation.
  await signIn(page, "lea@example.com");
  await ask(page, "Expenses helper", "Who approves a claim over 1,000 euros?");
  await expect(page.getByRole("link", { name: /^Citation 1:/ })).toBeVisible();
  await expect(page.getByText(/^[a-z0-9-]+ · [\d,]+ tokens$/).first()).toBeVisible();
});
