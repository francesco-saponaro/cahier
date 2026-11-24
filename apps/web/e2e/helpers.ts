import { expect, type Page } from "@playwright/test";

/*
 * The three demo accounts and the few moves every run makes. The database lives in the page, so
 * a run never reloads it: people sign out and in again through the app, and every move is a
 * click or a link, as a person would make it.
 */

export const PASSWORD = "cahier-demo";

export async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  // The person's initial at the foot of the rail opens the menu with Sign out.
  await page.getByRole("button", { name: /, Oriel$/ }).first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
}

/** The icon rail, wide layout: one link per destination, named by its label. */
export async function go(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: label, exact: true }).click();
}

/** Starts a conversation with the named agent and asks the question; answers once the answer has landed. */
export async function ask(page: Page, agentName: string, question: string): Promise<void> {
  await page.getByRole("link", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^${agentName}`) }).click();
  await expect(page.getByLabel("Your question")).toBeVisible();
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Ask" }).click();
}
