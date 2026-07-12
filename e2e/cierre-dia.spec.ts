import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Cierre del día" — a courier (mensajero) reviews everything they
 * managed during the day, sees the per-method-of-payment totals and requests the
 * day's closing (Feature 37, T17 / R7, R13–R15, F1.4 decision (g)).
 *
 * Covers the critical money flow happy path of the courier's day closing:
 *  Happy path: mensajero logs in → /cierre-dia → sees the managed orders grouped
 *  by result (Entregadas / Reprogramadas / Devueltas / Rechazadas) and the totals
 *  panel (efectivo / SIMPE / transferencia / general) → clicks "Solicitar cierre"
 *  → confirms in the modal → a success toast is shown and the newly created
 *  closing appears in the "Cierres solicitados" history in state `Solicitado`
 *  with the derived destination.
 *
 * PRECONDITION (seed): the courier must have ALL their assigned orders already
 * managed (no order in `en_espera_aceptacion` nor `en_reparto`) so that
 * "Solicitar cierre" is enabled (R10); and at least one managed gestion pending
 * of closing (`cierre_id IS NULL`) so the day is non-empty (R11).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres and the `cierre_dia` table + enums
 *   (feature 37 migration) plus the gestion/order catalog values seeded
 * - A seeded `mensajero` user WITH a `zonaId`, with all their assigned orders
 *   already managed (at least one `entregada` with a known amount+method so the
 *   totals are non-zero), and NO order left in `en_espera_aceptacion`/`en_reparto`
 * - The expected total amount for one method, injected as TOTAL_EFECTIVO below
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/asignacion-satelite.spec.ts, e2e/mis-asignaciones.spec.ts
 * and e2e/recepcion-satelite.spec.ts). They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed a mensajero (with zona) whose orders are ALL managed (>=1 entregada with
 *    a known amount+method) and none pending; set the seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded mensajero credentials (would come from test config / a user factory).
const MENSAJERO_EMAIL = "mensajero@example.com";
const MENSAJERO_PASSWORD = "correct-password";

// Expected cash total (₡ prefix added by the UI) of the seeded managed deliveries.
const TOTAL_EFECTIVO = "₡150.00";

/** Logs in as the seeded mensajero and lands on the app. */
async function loginMensajero(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', MENSAJERO_EMAIL);
  await page.fill('input[type="password"]', MENSAJERO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Cierre del día — mensajero solicita el cierre", () => {
  test.beforeEach(async ({ page }) => {
    await loginMensajero(page);
    await page.goto("/cierre-dia");
  });

  test("ve totales por método → Solicitar cierre → aparece 'Solicitado' en el histórico", async ({
    page,
  }) => {
    // The totals panel shows the per-method-of-payment sums (R7).
    const totales = page.getByRole("region", { name: "Totales del día" });
    await expect(totales).toBeVisible();
    await expect(totales.getByText(TOTAL_EFECTIVO)).toBeVisible();

    // At least one managed order is grouped under "Entregadas" (R3).
    await expect(page.getByRole("region", { name: "Entregadas" })).toBeVisible();

    // "Solicitar cierre" is enabled because all orders are managed (R10/R11).
    const solicitar = page
      .getByRole("region", { name: "Solicitar cierre" })
      .getByRole("button", { name: "Solicitar cierre" });
    await expect(solicitar).toBeEnabled();

    // Confirm in the modal (R13/R14/R15).
    await solicitar.click();
    const dialog = page.getByRole("dialog", { name: "Solicitar cierre del día" });
    await dialog.getByRole("button", { name: "Solicitar cierre" }).click();

    // Success feedback (toast) confirms the closing was created.
    await expect(page.getByText(/Cierre solicitado/i)).toBeVisible();

    // After router.refresh(), the new closing appears in the history as
    // "Solicitado" with its derived destination (R18).
    const historico = page.getByRole("region", { name: "Cierres solicitados" });
    await expect(historico.getByText("Solicitado")).toBeVisible();
    await expect(
      historico.getByText(/Bodega (central|satélite)/i),
    ).toBeVisible();
  });
});
