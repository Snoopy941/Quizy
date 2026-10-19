import { test, expect } from "@playwright/test";
import { createDeckFromNotes, signUp } from "./helpers";

test("phone layout: bottom tabs and studying work on a small screen", async ({ page }) => {
  await signUp(page);
  await createDeckFromNotes(page, "E2E Phone");
  await page.getByRole("link", { name: /study now/i }).click();
  await expect(page).toHaveURL(/\/study/);
  await expect(page.locator(".flip-face").first()).toBeVisible();
  const box = await page.locator(".flip-face").first().boundingBox();
  expect(box && box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
