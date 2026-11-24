import { expect, test } from "@playwright/test";
import { ask, signIn } from "./helpers";

/*
 * Léa asks the Handbook helper a question, reads the answer line by line with its citations, and
 * opens the first one: the viewer shows the handbook page with the cited passage marked, and the
 * marked text is the quote the answer carried. Everything runs on the database in the page.
 */
test("a member asks a question and opens the cited passage on the page", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, "lea@example.com");

  await ask(page, "Handbook helper", "How many days of paid leave do I earn a year?");
  const citation = page.getByRole("link", { name: /^Citation 1:/ });
  await expect(citation).toBeVisible();
  const quote = (await citation.getAttribute("title")) ?? "";
  expect(quote).toMatch(/25 working days/);
  await expect(page.getByText(/^[a-z0-9-]+ · [\d,]+ tokens$/).first()).toBeVisible();

  await citation.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Leave and time off/);
  const marked = page.locator("mark");
  await expect(marked.first()).toBeVisible();
  const markedText = (await marked.allTextContents()).join("");
  expect(markedText).toBe(quote);
});
