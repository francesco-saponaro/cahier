import { expect, test } from "@playwright/test";
import { go, signIn, signOut } from "./helpers";

/*
 * Noor invites a new colleague and passes on the token the app shows once; the colleague joins
 * from the sign-in page with the token, a name and a password, and lands in the chat as a member
 * of Oriel. The members list then counts one more.
 */
test("an invitation is sent, passed on and accepted", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, "noor@example.com");

  await go(page, "Admin");
  await page.getByRole("link", { name: "Members" }).click();
  await page.getByLabel("Email").fill("sam.okafor@example.com");
  await page.getByRole("button", { name: "Invite" }).click();
  const notice = page.getByText(/The invitation for sam.okafor@example.com is ready/);
  await expect(notice).toBeVisible();
  const token = (await notice.locator("code").textContent())?.trim() ?? "";
  expect(token.length).toBeGreaterThan(20);
  await signOut(page);

  await page.getByRole("button", { name: "Joining with an invitation?" }).click();
  await page.getByLabel("Invitation token").fill(token);
  await page.getByLabel("Your name").fill("Sam Okafor");
  await page.getByLabel("Password").fill("a long enough password");
  await page.getByRole("button", { name: "Join the workspace" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sam Okafor, Oriel" }).first()).toBeVisible();
  // A member sees no Admin destination.
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Admin" })).toHaveCount(0);
});
