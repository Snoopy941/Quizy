import { expect, type Page } from "@playwright/test";

export const NOTES = `# Photosynthesis
Photosynthesis is the process by which plants convert light energy into chemical energy stored in glucose. It takes place in chloroplasts, which contain the green pigment chlorophyll. The light-dependent reactions occur in the thylakoid membranes and split water to release oxygen.

# Cellular Respiration
Cellular respiration releases the energy stored in glucose. Glycolysis occurs in the cytoplasm and produces two molecules of pyruvate. The Krebs cycle runs in the mitochondrial matrix. The electron transport chain produces most of the ATP through chemiosmosis.`;

/** Sign up a fresh account and land on the dashboard. */
export async function signUp(page: Page): Promise<{ email: string; password: string; recoveryCode: string }> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = "correct-horse-battery";
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Student");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create account|sign up/i }).click();
  await expect(page.getByText("Save your recovery code")).toBeVisible();
  const recoveryCode = (await page.locator(".font-mono").first().innerText()).trim();
  await page.getByRole("button", { name: /continue to quizy/i }).click();
  await expect(page).toHaveURL(/\/$/);
  return { email, password, recoveryCode };
}

/** Create a deck from pasted notes and wait for its cards. Returns the deck URL. */
export async function createDeckFromNotes(page: Page, name = "E2E Biology"): Promise<string> {
  await page.goto("/library/new");
  await page.getByRole("button", { name: "Paste text" }).click();
  await page.getByLabel("Your notes").fill(NOTES);
  await page.getByLabel("Deck name").fill(name);
  await page.getByRole("button", { name: /create & generate cards/i }).click();
  await expect(page).toHaveURL(/\/deck\/[^/?]+/);
  await expect(page.getByRole("link", { name: /study now/i })).toBeVisible({ timeout: 60_000 });
  return page.url().split("?")[0];
}
