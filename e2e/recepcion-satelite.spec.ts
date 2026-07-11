import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Recepción satélite" — adminSatelite QR reception flow
 * (Feature 33, T15 / R22, F1.4 decisión (g)).
 *
 * Covers the critical happy path of the satellite-warehouse reception:
 *  Happy path (keyboard-wedge): adminSatelite logs in → /recepcion-satelite →
 *  types an `orden.id` into the scan input (simulating the physical barcode/QR
 *  gun, which "types" the decoded text + Enter) → the order transitions
 *  `en_ruta_bodega_satelite` → `en_bodega_satelite` and moves from the "Por
 *  recibir" region into the "Recibidas" region.
 *
 * MANUAL VERIFICATION (not automatable here):
 *  - The physical keyboard-wedge scanner gun (hardware "types" into the input):
 *    verified manually; this E2E simulates that input as plain typed text.
 *  - The device CAMERA path (getUserMedia + html5-qrcode): requires a real camera
 *    and a rendered QR; verified manually. CI has no camera/media, so it is out of
 *    scope for this automated spec.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres and the `en_bodega_satelite` catalog
 *   value seeded (feature 33 migration applied)
 * - A seeded `adminSatelite` user WITH a `zonaId`, and at least one order in
 *   `en_ruta_bodega_satelite` in that same zone (so "Por recibir" is non-empty)
 * - The `orden.id` of that seeded order, injected as ORDEN_ID below
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/auth.spec.ts and e2e/mis-asignaciones.spec.ts). They do
 * NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed an adminSatelite (with zona) + an order in en_ruta_bodega_satelite of
 *    that zona; set ORDEN_ID to that order's id
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded adminSatelite credentials (would come from test config / a user factory).
const ADMIN_SATELITE_EMAIL = "admin-satelite@example.com";
const ADMIN_SATELITE_PASSWORD = "correct-password";

// Id (QR content) of a seeded order in `en_ruta_bodega_satelite` of the actor's zone.
const ORDEN_ID = "seed-orden-en-ruta-bodega-satelite";

/** Logs in as the seeded adminSatelite and lands on the app. */
async function loginAdminSatelite(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_SATELITE_EMAIL);
  await page.fill('input[type="password"]', ADMIN_SATELITE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Recepción satélite — recepción por QR (keyboard-wedge)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAdminSatelite(page);
    await page.goto("/recepcion-satelite");
  });

  test("escanear (teclear orden.id + Enter) → la orden pasa a 'Recibidas'", async ({
    page,
  }) => {
    // Both sections render, differentiated by their accessible region name.
    const porRecibir = page.getByRole("region", { name: "Por recibir" });
    const recibidas = page.getByRole("region", { name: "Recibidas" });
    await expect(porRecibir).toBeVisible();
    await expect(recibidas).toBeVisible();

    // Simulate the physical scanner: focus the input, type the orden.id, press Enter.
    const input = page.getByRole("textbox", { name: "Código de la orden" });
    await input.click();
    await input.fill(ORDEN_ID);
    await input.press("Enter");

    // Reception feedback (per-item toast) confirms success.
    await expect(page.getByText(/recibida/i)).toBeVisible();

    // After router.refresh(), the order shows up under "Recibidas" as
    // `en_bodega_satelite` (estado legible "En bodega satélite de <zona>").
    await expect(recibidas.getByText(/En bodega satélite de/i)).toBeVisible();
  });
});
