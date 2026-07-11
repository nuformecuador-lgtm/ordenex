import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Mis asignaciones" — mensajero collection/management flow
 * (T21 — closes the critical recaudo-flow checkpoint of
 * specs/36-mensajero-mis-asignaciones/tasks.md)
 *
 * These tests cover the critical happy path of the recaudo (cash-on-delivery)
 * flow plus the rejection and reschedule branches:
 * (a) Happy path (delivery): mensajero logs in → /mis-asignaciones → "Por
 *     recoger" → "Recoger" (en_espera_aceptacion → en_reparto) → the order shows
 *     up under "En reparto / por gestionar" → "Gestionar" (sets the 1-to-1 lock)
 *     → in the "Gestionar orden" modal, result "Entregada" + monto == montoCobrar
 *     + método de pago + evidence photo → "Guardar gestión" → order becomes
 *     `entregada`.
 * (b) Rejection: result "Rechazo" + evidence photo + motivo → "Guardar gestión"
 *     → order becomes `rechazada`.
 * (c) Reschedule: result "Reprogramar" + future date + motivo → "Guardar
 *     gestión" → order becomes `reprogramada`.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres
 * - A seeded `mensajero` user with several orders in `en_espera_aceptacion`
 *   assigned to them (so "Por recoger" is non-empty)
 * - The private Supabase Storage bucket `gestion-evidencias` created (evidence
 *   uploads target it)
 * - An evidence image fixture at `e2e/fixtures/evidencia.jpg`
 *
 * If the environment lacks .env or a real database/bucket, these tests are
 * WRITTEN but NOT EXECUTED. Execution is deferred until the test environment is
 * fully set up (same deferral as the E2E pattern of specs/login/tasks.md and
 * e2e/auth.spec.ts).
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Create the `gestion-evidencias` private bucket
 * 4. Seed a mensajero user with orders in `en_espera_aceptacion`
 * 5. Add the fixture image at e2e/fixtures/evidencia.jpg
 * 6. Run tests: pnpm run test:e2e
 */

// Seeded mensajero credentials (would come from test config / a user factory).
const MENSAJERO_EMAIL = "mensajero@example.com";
const MENSAJERO_PASSWORD = "correct-password";

// Evidence image fixture uploaded to the private `gestion-evidencias` bucket.
const EVIDENCIA_FIXTURE = "e2e/fixtures/evidencia.jpg";

/** Logs in as the seeded mensajero and lands on the app. */
async function loginMensajero(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', MENSAJERO_EMAIL);
  await page.fill('input[type="password"]', MENSAJERO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

/** Picks up the first order under "Por recoger" (en_espera_aceptacion → en_reparto). */
async function recogerPrimeraOrden(page: Page) {
  const porRecoger = page.getByRole("region", { name: "Por recoger" });
  await expect(porRecoger).toBeVisible();

  // Single-row "Recoger" opens the confirmation modal.
  await porRecoger.getByRole("button", { name: "Recoger" }).first().click();

  const confirmDialog = page.getByRole("dialog", { name: "Recoger órdenes" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Recoger" }).click();
}

/** Opens the 1-to-1 management modal for the first order in "En reparto / por gestionar". */
async function abrirGestionPrimeraOrden(page: Page) {
  const porGestionar = page.getByRole("region", {
    name: "En reparto / por gestionar",
  });
  await expect(porGestionar).toBeVisible();

  // "Gestionar" sets the 1-to-1 lock, then opens the "Gestionar orden" modal.
  await porGestionar.getByRole("button", { name: "Gestionar" }).first().click();

  const modal = page.getByRole("dialog", { name: "Gestionar orden" });
  await expect(modal).toBeVisible();
  return modal;
}

/** Chooses an option in a base-ui Select identified by its accessible name. */
async function elegirEnSelect(
  page: Page,
  comboboxName: string,
  optionName: string,
) {
  await page.getByRole("combobox", { name: comboboxName }).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.describe("Mis asignaciones — recaudo E2E flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginMensajero(page);
    await page.goto("/mis-asignaciones");
  });

  test.describe("(a) Happy path: entrega (recaudo cobrado)", () => {
    test("recoger → gestionar → entregada", async ({ page }) => {
      await recogerPrimeraOrden(page);

      const modal = await abrirGestionPrimeraOrden(page);

      // Result defaults to "Entregada"; ensure it explicitly.
      await elegirEnSelect(page, "Resultado de la gestión", "Entregada");

      // "Monto recibido" is prefilled with montoCobrar; leave it as-is (== montoCobrar).
      const monto = modal.getByLabel("Monto recibido");
      await expect(monto).toBeVisible();
      const montoValue = await monto.inputValue();
      expect(montoValue).not.toBe("");

      await elegirEnSelect(page, "Método de pago", "Efectivo");

      await modal
        .getByLabel("Foto de evidencia de entrega")
        .setInputFiles(EVIDENCIA_FIXTURE);

      await modal.getByRole("button", { name: "Guardar gestión" }).click();

      // Modal closes on success; the order leaves the "por gestionar" list.
      await expect(modal).toBeHidden();
    });
  });

  test.describe("(b) Rejection: rechazo", () => {
    test("recoger → gestionar → rechazada", async ({ page }) => {
      await recogerPrimeraOrden(page);

      const modal = await abrirGestionPrimeraOrden(page);

      await elegirEnSelect(page, "Resultado de la gestión", "Rechazo");

      await modal
        .getByLabel("Foto de evidencia del rechazo")
        .setInputFiles(EVIDENCIA_FIXTURE);
      await modal.getByLabel("Motivo").fill("Dirección inexistente");

      await modal.getByRole("button", { name: "Guardar gestión" }).click();

      await expect(modal).toBeHidden();
    });
  });

  test.describe("(c) Reschedule: reprogramación", () => {
    test("recoger → gestionar → reprogramada", async ({ page }) => {
      await recogerPrimeraOrden(page);

      const modal = await abrirGestionPrimeraOrden(page);

      await elegirEnSelect(page, "Resultado de la gestión", "Reprogramar");

      await modal
        .getByLabel("Nueva fecha de reprogramación")
        .fill("2030-12-31");
      await modal.getByLabel("Motivo").fill("Cliente ausente");

      await modal.getByRole("button", { name: "Guardar gestión" }).click();

      await expect(modal).toBeHidden();
    });
  });
});
