import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Cierre de bodega satélite → bodega principal" — the second closing
 * level (Feature 40, T10 / R1-R2, R11-R13, R15-R17, F1.4 decisions e/h/i/l).
 *
 * The module `/cierres-admin` is role-aware: it extends the feature-38 courier
 * closings with the feature-40 warehouse (bodega) closings. Two roles participate:
 *  - adminSatelite (SOLICITA): consolidates their zone's already-`aprobado`
 *    `cierre_dia` and requests the warehouse closing to the central bodega.
 *  - maestro (APRUEBA/RECHAZA): reviews the aggregated detail of each requested
 *    warehouse closing and approves or rejects it.
 *
 * Covers the critical money flow of the warehouse closing end-to-end:
 *  1) adminSatelite path (request): logs in → /cierres-admin → the "Cierre de bodega"
 *     region shows the aggregated totals + the `cierre_dia` to consolidate →
 *     "Solicitar cierre de bodega" is enabled (no pending courier closings, R6/R7) →
 *     confirms in the modal → a success toast is shown and the new warehouse closing
 *     appears in "Cierres de bodega solicitados" as "Solicitado".
 *  2) maestro path (approve): logs in → /cierres-admin → the "Cierres de bodega
 *     satélite" region shows the requested closing in "Cierres de bodega pendientes"
 *     → clicks "Ver / decidir" → the aggregated detail modal shows the snapshot
 *     totals (R11/R13), the per-`cierre_dia` sub-detail with its 4 result sections
 *     and the signed evidence viewer for a rejected order (R12) → clicks "Aprobar" →
 *     a success toast is shown and the closing moves to "Cierres de bodega resueltos"
 *     as "Aprobado".
 *  3) maestro path (reject): same up to the detail modal → clicks "Rechazar" → a
 *     sub-modal requires a non-empty reason (R17) → typing a reason and confirming
 *     moves the closing to the history as "Rechazado" with the reason persisted.
 *
 * PRECONDITION (seed):
 * - An `adminSatelite` user WITH a `zona` (satélite), and within that zone at least
 *   one `cierre_dia` in state `aprobado`, `destino_tipo = bodega_satelite`,
 *   `destino_zona_id = the admin's zona` and `cierre_bodega_id IS NULL` (consolidable,
 *   R5), each with its snapshot totals and gestiones (at least one `entregada` with a
 *   known amount+method, and at least one `rechazada` with a stored evidence so the
 *   signed-URL viewer can be exercised, R12). NO `cierre_dia` in state `solicitado`
 *   left in that zone (otherwise the request is blocked, R6). No pre-existing
 *   `solicitado` warehouse closing for that zone (R8).
 * - A `maestro` user (central bodega) whose scope is ALL warehouse closings (no zone
 *   filter). After the adminSatelite requests, the maestro must see it in the queue.
 * - The expected cash total (₡ prefix added by the UI) injected below.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres, the `cierre_bodega` table + the
 *   `cierre_dia.cierre_bodega_id` FK (feature 40 migration), the feature 37/38
 *   `cierre_dia` table/enums/audit columns, and the gestion/order catalog values
 *   seeded
 * - A seeded `adminSatelite` (WITH a zona) with consolidable `cierre_dia` and no
 *   pending courier closings, plus a seeded `maestro`; the expected cash total below
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/cierres-admin.spec.ts and e2e/cierre-dia.spec.ts).
 * They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed an adminSatelite (with zona) with consolidable `cierre_dia` (no pending
 *    courier closings) and a maestro; set the seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded credentials (would come from test config / a user factory).
const ADMIN_SATELITE_EMAIL = "adminsatelite@example.com";
const ADMIN_SATELITE_PASSWORD = "correct-password";
const MAESTRO_EMAIL = "maestro@example.com";
const MAESTRO_PASSWORD = "correct-password";

// Expected aggregated cash total (₡ prefix added by the UI) of the seeded snapshot.
const TOTAL_EFECTIVO = "₡150.00";

/** Logs in with the given credentials and lands on the app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Cierre de bodega — adminSatelite consolida y solicita", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_SATELITE_EMAIL, ADMIN_SATELITE_PASSWORD);
    await page.goto("/cierres-admin");
  });

  test("ve consolidables + totales → Solicitar cierre de bodega → aparece 'Solicitado' en el histórico", async ({
    page,
  }) => {
    // The warehouse closing region is visible for the adminSatelite (R1/F1.4-l).
    const bodega = page.getByRole("region", { name: "Cierre de bodega" });
    await expect(bodega).toBeVisible();

    // Aggregated snapshot totals to consolidate (R10/R13).
    const totales = bodega.getByRole("region", { name: "Totales a consolidar" });
    await expect(totales).toBeVisible();
    await expect(totales.getByText(TOTAL_EFECTIVO)).toBeVisible();

    // The `cierre_dia` to consolidate are listed (R5).
    await expect(
      bodega.getByRole("region", { name: "Cierres del día a consolidar" }),
    ).toBeVisible();

    // "Solicitar cierre de bodega" is enabled because there are consolidables and
    // no pending courier closings in the zone (R6/R7).
    const solicitar = bodega
      .getByRole("region", { name: "Solicitar cierre de bodega" })
      .getByRole("button", { name: "Solicitar cierre de bodega" });
    await expect(solicitar).toBeEnabled();

    // Confirm in the modal (R9/R10).
    await solicitar.click();
    const dialog = page.getByRole("dialog", {
      name: "Solicitar cierre de bodega",
    });
    await dialog
      .getByRole("button", { name: "Solicitar cierre de bodega" })
      .click();

    // Success feedback (toast) confirms the warehouse closing was created.
    await expect(page.getByText(/Cierre de bodega solicitado/i)).toBeVisible();

    // After router.refresh(), the new closing appears in the history as "Solicitado".
    const historico = page.getByRole("region", {
      name: "Cierres de bodega solicitados",
    });
    await expect(historico.getByText("Solicitado")).toBeVisible();
  });
});

test.describe("Cierre de bodega — maestro aprueba/rechaza", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, MAESTRO_EMAIL, MAESTRO_PASSWORD);
    await page.goto("/cierres-admin");
  });

  test("ve la cola → abre el detalle agregado (totales+sub-detalle+evidencia) → aprueba → pasa a histórico", async ({
    page,
  }) => {
    // The warehouse-closing queue is visible for the maestro (R2/R15).
    const modulo = page.getByRole("region", {
      name: "Cierres de bodega satélite",
    });
    await expect(modulo).toBeVisible();

    const pendientes = modulo.getByRole("region", {
      name: "Cierres de bodega pendientes",
    });
    await expect(pendientes).toBeVisible();

    // Open the aggregated detail of the first pending warehouse closing.
    await pendientes
      .getByRole("button", { name: "Ver / decidir" })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Detalle del cierre de bodega",
    });
    await expect(dialog).toBeVisible();

    // Aggregated snapshot totals panel (R11/R13).
    const totales = dialog.getByRole("region", {
      name: "Totales del cierre de bodega",
    });
    await expect(totales).toBeVisible();
    await expect(totales.getByText(TOTAL_EFECTIVO)).toBeVisible();

    // Per-`cierre_dia` sub-detail: at least one rejected order with signed evidence
    // (R11/R12). The evidence opens via a signed URL in the viewer.
    const rechazadas = dialog
      .getByRole("region", { name: "Rechazadas" })
      .first();
    await rechazadas
      .getByRole("button", { name: "Ver evidencia" })
      .first()
      .click();
    const visor = page.getByRole("dialog", { name: "Evidencia de la gestión" });
    await expect(
      visor.getByRole("img", { name: "Evidencia fotográfica de la gestión" }),
    ).toBeVisible();
    await visor.getByRole("button", { name: "Cerrar" }).click();

    // Approve the warehouse closing (R16).
    await dialog.getByRole("button", { name: "Aprobar" }).click();

    // Success feedback (toast) confirms the decision.
    await expect(page.getByText(/Cierre de bodega aprobado/i)).toBeVisible();

    // After router.refresh(), it appears in the history as "Aprobado" (R15).
    const historico = modulo.getByRole("region", {
      name: "Cierres de bodega resueltos",
    });
    await expect(historico.getByText("Aprobado")).toBeVisible();
  });

  test("rechazar exige motivo → con motivo pasa a histórico como Rechazado", async ({
    page,
  }) => {
    const modulo = page.getByRole("region", {
      name: "Cierres de bodega satélite",
    });
    const pendientes = modulo.getByRole("region", {
      name: "Cierres de bodega pendientes",
    });
    await pendientes
      .getByRole("button", { name: "Ver / decidir" })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Detalle del cierre de bodega",
    });
    await expect(dialog).toBeVisible();

    // Open the reject sub-modal (R17).
    await dialog.getByRole("button", { name: "Rechazar" }).click();
    const rechazo = page.getByRole("dialog", {
      name: "Rechazar cierre de bodega",
    });
    await expect(rechazo).toBeVisible();

    // Confirming with an empty reason is blocked and shows the validation error (R17).
    await rechazo
      .getByRole("button", { name: "Rechazar cierre de bodega" })
      .click();
    await expect(
      rechazo.getByText("El motivo de rechazo es obligatorio."),
    ).toBeVisible();

    // With a reason, the rejection goes through (R17).
    await rechazo
      .getByLabel("Motivo del rechazo")
      .fill("Los montos agregados no cuadran");
    await rechazo
      .getByRole("button", { name: "Rechazar cierre de bodega" })
      .click();

    await expect(page.getByText(/Cierre de bodega rechazado/i)).toBeVisible();

    const historico = modulo.getByRole("region", {
      name: "Cierres de bodega resueltos",
    });
    await expect(historico.getByText("Rechazado")).toBeVisible();
    await expect(
      historico.getByText("Los montos agregados no cuadran"),
    ).toBeVisible();
  });
});
