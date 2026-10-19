import { test, expect } from "@playwright/test";
import { createDeckFromNotes, signUp } from "./helpers";

test("sign up, make a deck from notes, and study it", async ({ page }) => {
  await signUp(page);
  const deckUrl = await createDeckFromNotes(page);

  // Cards were generated, grouped by the two headings, with source links
  await expect(page.getByText("Photosynthesis", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Cellular Respiration/i).first()).toBeVisible();

  // Study: answer whatever card comes up, then grade it
  await page.getByRole("link", { name: /study now/i }).click();
  await expect(page).toHaveURL(/\/study/);
  // Let the dev server finish compiling the study page before interacting
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 3; i++) {
    // Answer choices are labelled "1 …", "2 …"; match them by name anywhere on the card
    const option = page.getByRole("button", { name: /^1\s/ }).first();
    const typed = page.getByPlaceholder(/type your answer|fill in the blank/i);
    if (await typed.isVisible().catch(() => false)) {
      await typed.fill("chlorophyll");
      await page.getByRole("button", { name: /^check$/i }).click();
    } else if (await option.isVisible().catch(() => false)) {
      await option.click();
    } else {
      // Flip the card by clicking it, like a person would
      await page.getByText(/click or press Space to flip/i).click();
    }
    await page.getByRole("button", { name: /^good/i }).click();
    await page.waitForTimeout(1200);
  }

  // Deck page shows progress afterwards
  await page.goto(deckUrl);
  await expect(page.getByText(/cards ·/)).toBeVisible();
});

test("settings: AI section, security, and sign out ends the session", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "AI" })).toBeVisible();
  await expect(page.getByText(/Demo generator|No AI set up yet|Making cards with/)).toBeVisible();

  const res = await page.request.post("/api/auth/logout");
  expect(res.ok()).toBeTruthy();
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(401);
});

test("password reset with the recovery code", async ({ page, context }) => {
  const acct = await signUp(page);
  await context.clearCookies();
  await page.goto("/forgot");
  await page.getByLabel("Email").fill(acct.email);
  await page.getByLabel(/recovery code/i).fill(acct.recoveryCode);
  await page.getByLabel(/new password/i).fill("a-brand-new-password");
  await page.getByRole("button", { name: /reset password/i }).click();
  await expect(page.getByText("Save your recovery code")).toBeVisible();

  // Old password no longer works, new one does
  const bad = await page.request.post("/api/auth/login", { data: { email: acct.email, password: acct.password } });
  expect(bad.status()).toBe(401);
  const good = await page.request.post("/api/auth/login", { data: { email: acct.email, password: "a-brand-new-password" } });
  expect(good.ok()).toBeTruthy();
});

test("wrong passwords are rate-limited", async ({ page }) => {
  const acct = await signUp(page);
  let last = 0;
  for (let i = 0; i < 6; i++) {
    const r = await page.request.post("/api/auth/login", { data: { email: acct.email, password: "nope-nope-nope" } });
    last = r.status();
  }
  expect(last).toBe(429);
});

test("deck tools: summary, chat and quality pages open", async ({ page }) => {
  await signUp(page);
  const deckUrl = await createDeckFromNotes(page, "E2E Tools");
  for (const sub of ["summary", "chat", "quality"]) {
    const r = await page.goto(`${deckUrl}/${sub}`);
    expect(r?.ok()).toBeTruthy();
    await expect(page.locator("h1").first()).toBeVisible();
  }
});
