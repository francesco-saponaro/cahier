import { expect, test } from "@playwright/test";
import { ask, go, signIn, signOut } from "./helpers";

/*
 * Noor sets this month's budget to nothing, and the next question in the workspace is refused as
 * "budget exhausted" with no usage written; she raises it again and the same agent answers. The
 * usage dashboard shows the budget both times.
 */
test("the budget stops the answers and lets them through again", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, "noor@example.com");

  await go(page, "Admin");
  await page.getByRole("link", { name: "Settings" }).click();
  const thisMonth = page.getByLabel(/^Limit for (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/).first();
  await thisMonth.fill("0");
  await page.getByRole("button", { name: "Set the budget" }).first().click();
  await expect(page.getByRole("heading", { name: "Budgets so far" }).locator("..")).toContainText("$0.00");
  await signOut(page);

  await signIn(page, "lea@example.com");
  await ask(page, "Handbook helper", "How many days of paid leave do I earn a year?");
  await expect(page.getByText("Refused: budget exhausted")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Citation 1:/ })).toHaveCount(0);
  await signOut(page);

  await signIn(page, "noor@example.com");
  await go(page, "Admin");
  await page.getByRole("link", { name: "Settings" }).click();
  await thisMonth.fill("5");
  await page.getByRole("button", { name: "Set the budget" }).first().click();
  await expect(page.getByRole("heading", { name: "Budgets so far" }).locator("..")).toContainText("$5.00");
  await page.getByRole("link", { name: "Usage" }).click();
  await expect(page.getByText("$5.00").first()).toBeVisible();
  await signOut(page);

  await signIn(page, "lea@example.com");
  await ask(page, "Handbook helper", "How many days of paid leave do I earn a year?");
  await expect(page.getByRole("link", { name: /^Citation 1:/ })).toBeVisible();
});
