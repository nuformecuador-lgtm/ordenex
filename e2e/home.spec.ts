import { test, expect } from "@playwright/test";

test("la pagina principal carga", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Next/);
});
