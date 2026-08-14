import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Mis asignaciones" — mensajero collection/management flow
 * (T21 — closes the critical recaudo-flow checkpoint of
 * specs/36-mensajero-mis-asignaciones/tasks.md)
 *
 * These tests cover the critical happy path of the recaudo (cash-on-delivery)
 * flow plus the rejection and reschedule branches:
 * (a) Happy path (delivery): mensajero logs in → /mis-asignaciones → "Por
 *     recoger" → "Recoger" (por_recoger → en_reparto) → the order shows
 *     up under "En reparto / por gestionar" → "Gestionar" (sets the 1-to-1 lock)
 *     → in the "Gestionar orden" modal, result "Entregada" + monto == montoCobrar
 *     + método de pago + evidence photo → "Guardar gestión" → order becomes
 *     `entregada`.
 * (b) Rejection: result "Rechazo" + evidence photo + motivo → "Guardar gestión"
 *     → order becomes `rechazada`.
 * (c) Reschedule: result "Reprogramar" + future date + motivo → "Guardar
 *     gestión" → order becomes `reprogramada`.
 * (d) Feature 213 (R35) — MIXED delivery: an 8.000 collection split into 5.000
 *     cash + 3.000 transfer, followed by a check that the day's closing screen
 *     shows `total_efectivo` = 5.000. This is the full capture → totals path,
 *     which is what actually protects the `E` of the `min(P, E)` used to pay the
 *     mensajero (feature 44): whatever the mensajero captures here IS that `E`.
 *
 * FEATURE 213 SCOPE ([Q5], closed at the approval gate on 2026-08-13):
 * this spec was ALREADY out of date before feature 213. Only the RECAUDO part
 * was updated here — the single "Método de pago" select became one accessible
 * "Método de pago línea N" per payment line. Everything else was left ALONE on
 * purpose, as separate debt:
 *   · `recogerPrimeraOrden` still assumes the per-row "Recoger" button and the
 *     "Recoger órdenes" confirmation modal, both removed by feature 96 (pick-up
 *     is now the guide input or the scanner);
 *   · `abrirGestionPrimeraOrden` still waits for a `dialog` named "Gestionar
 *     orden" that the ux redesign (feature 113) replaced with an INLINE panel,
 *     so every `expect(modal).toBeHidden()` is obsolete too;
 *   · `elegirEnSelect(page, "Resultado de la gestión", …)` is obsolete as well:
 *     the result is now chosen with buttons, not with a select.
 * Fixing those is a separate ticket, not this one.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres
 * - A seeded `mensajero` user with several orders in `por_recoger`
 *   assigned to them (so "Por recoger" is non-empty)
 * - For (d): the FIRST of those orders must have `montoCobrar` = 8000 and the
 *   day's `cierre_dia` must start empty, so that `total_efectivo` = 5.000 is
 *   attributable to this delivery and to nothing else
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
 * 4. Seed a mensajero user with orders in `por_recoger`
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

/**
 * Picks up the first order under "Por recoger" (por_recoger → en_reparto).
 *
 * 2026-07-31: "Por recoger" moved to its own route, so this helper navigates there and the
 * caller is expected to go back to /mis-asignaciones/reparto afterwards.
 *
 * PRE-EXISTING DRIFT (not introduced by the route split): the interactions below still
 * assume the per-row "Recoger" button and the "Recoger órdenes" confirmation modal, both
 * removed by feature 96 (pick-up is now the guide input or the scanner), and
 * `abrirGestionPrimeraOrden` still assumes the "Gestionar orden" dialog that feature 113
 * replaced with an inline panel. This spec needs a seeded DB and is not part of the unit
 * gate, so it was already red before this change; it is left as-is rather than rewritten
 * blind.
 */
async function recogerPrimeraOrden(page: Page) {
  await page.goto("/mis-asignaciones/recoger");
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

/**
 * Feature 213 (R1/R2) — fills payment LINE `n` of the delivery breakdown.
 *
 * There is no single "Método de pago" select any more: a delivery with a
 * collection shows one line per payment method, each line a
 * "Método de pago línea N" combobox plus a "Monto línea N" amount input.
 *
 * `monto` is optional because the editor PRE-FILLS it ([Q4]: line 1 with the
 * full amount to collect, a new line with what is still pending), so the
 * single-method case is still a single gesture and the test must not pretend
 * otherwise by always typing.
 */
async function capturarLineaDePago(
  page: Page,
  n: number,
  metodo: string,
  monto?: string,
) {
  await elegirEnSelect(page, `Método de pago línea ${n}`, metodo);
  if (monto !== undefined) {
    await page.getByLabel(`Monto línea ${n}`).fill(monto);
  }
}

test.describe("Mis asignaciones — recaudo E2E flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginMensajero(page);
    await page.goto("/mis-asignaciones/reparto");
  });

  test.describe("(a) Happy path: entrega (recaudo cobrado)", () => {
    test("recoger → gestionar → entregada", async ({ page }) => {
      await recogerPrimeraOrden(page);

      const modal = await abrirGestionPrimeraOrden(page);

      // Result defaults to "Entregada"; ensure it explicitly.
      await elegirEnSelect(page, "Resultado de la gestión", "Entregada");

      // Feature 213: one line, method only — the amount comes pre-filled with the
      // full amount to collect, so a single-method delivery is still one gesture.
      await capturarLineaDePago(page, 1, "Efectivo");

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
  test.describe("(d) Feature 213 (R35): entrega MIXTA → totales del cierre", () => {
    test("8.000 = 5.000 efectivo + 3.000 transferencia → total_efectivo 5.000", async ({
      page,
    }) => {
      await recogerPrimeraOrden(page);

      const modal = await abrirGestionPrimeraOrden(page);

      await elegirEnSelect(page, "Resultado de la gestión", "Entregada");

      // R1/R2: line 1 arrives pre-filled with the whole 8.000; the mixed case is
      // the one where the mensajero has to correct it down to what was paid in cash.
      await capturarLineaDePago(page, 1, "Efectivo", "5000");

      // R3/R4: the new line is born with what is still PENDING (3.000). It is
      // typed anyway: the test must not depend on the pre-fill to reach the
      // amount it is going to assert on the closing screen.
      await modal.getByRole("button", { name: "Añadir método" }).click();
      await capturarLineaDePago(page, 2, "Transferencia", "3000");

      // R8: the breakdown adds up, so the difference is zero and the panel lets
      // the gestión through (R9 would block it otherwise, before any request).
      const resumen = modal.locator('[aria-label="Resumen del cobro"]');
      await expect(resumen).toContainText(/8[.,]000/);
      await expect(resumen).toContainText(/5[.,]000|3[.,]000/);

      await modal
        .getByLabel("Foto de evidencia de entrega")
        .setInputFiles(EVIDENCIA_FIXTURE);

      await modal.getByRole("button", { name: "Guardar gestión" }).click();
      await expect(modal).toBeHidden();

      // R35 — THE POINT OF THIS TEST: the totals of the day are not recalculated
      // by this feature, they are FED by what was captured above. 5.000 of the
      // 8.000 went in as cash, so `total_efectivo` must be 5.000 and not 8.000.
      // That number is the `E` of the `min(P, E)` the mensajero gets paid with.
      await page.goto("/cierre-dia");

      const totales = page.getByRole("region", { name: "Totales del día" });
      await expect(totales).toBeVisible();

      const efectivo = totales.locator("div").filter({ hasText: /^Efectivo/ }).first();
      const transferencia = totales
        .locator("div")
        .filter({ hasText: /^Transferencia/ })
        .first();

      // Amounts are asserted with a loose separator: the currency symbol and the
      // thousands separator come from configuration (`lib/config/moneda.ts`), so
      // hardcoding "₡5.000,00" here would pin the test to one deployment.
      await expect(efectivo).toContainText(/5[.,]000/);
      await expect(efectivo).not.toContainText(/8[.,]000/);
      await expect(transferencia).toContainText(/3[.,]000/);
    });
  });
});
