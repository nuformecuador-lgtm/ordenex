import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Cierres del día" (admin) — a warehouse admin (maestro for the
 * central/GAM warehouse, adminSatelite for a satellite one) reviews the closings
 * their couriers requested, opens the full detail (per-method totals + evidence)
 * and approves or rejects each one (Feature 38, T15 / R4-R11, F1.4 decisions c/g).
 *
 * Covers the critical money flow happy path of the admin's decision:
 *  Happy path (approve): admin logs in → /cierres-admin → sees a courier's closing
 *  in "Pendientes de decisión" (Solicitado) → clicks "Ver / decidir" → the detail
 *  modal shows the snapshot totals panel and the 4 result sections (with signed
 *  evidence for rejected orders) → clicks "Aprobar" → a success toast is shown and
 *  the closing moves to the "Histórico" section as "Aprobado".
 *
 *  Alternate path (reject): same up to the detail modal → clicks "Rechazar" →
 *  a sub-modal requires a non-empty reason (R11) → typing a reason and confirming
 *  moves the closing to "Histórico" as "Rechazado" with the reason persisted.
 *
 * PRECONDITION (seed): at least one `cierre_dia` in state `solicitado` within the
 * admin's scope (destino_tipo = bodega_central for maestro; bodega_satelite + the
 * admin's zona for adminSatelite), with its snapshot totals and gestiones (at least
 * one `entregada` with a known amount+method, and at least one `rechazada` with a
 * stored evidence so the signed-URL viewer can be exercised, R7).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres, the `cierre_dia` table + enums and the
 *   feature 38 audit columns (resuelto_por/resuelto_at/motivo_rechazo) plus the
 *   gestion/order catalog values seeded
 * - A seeded `maestro` (or `adminSatelite` WITH a zona) whose scope contains at
 *   least one closing in `solicitado`; the expected cash total injected below
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/cierre-dia.spec.ts and e2e/recepcion-satelite.spec.ts).
 * They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed a maestro/adminSatelite and a courier closing in `solicitado` within the
 *    admin's scope; set the seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded admin credentials (would come from test config / a user factory).
const ADMIN_EMAIL = "maestro@example.com";
const ADMIN_PASSWORD = "correct-password";

// Expected cash total (₡ prefix added by the UI) of the seeded closing snapshot.
const TOTAL_EFECTIVO = "₡150.00";

/** Logs in as the seeded admin and lands on the app. */
async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Cierres del día — admin decide un cierre solicitado", () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/cierres-admin");
  });

  test("ve un cierre Solicitado → abre detalle (totales+evidencia) → aprueba → pasa a histórico", async ({
    page,
  }) => {
    // The pending queue shows the courier's closing (R4).
    const pendientes = page.getByRole("region", {
      name: "Pendientes de decisión",
    });
    await expect(pendientes).toBeVisible();

    // Open the full detail of the first pending closing.
    await pendientes.getByRole("button", { name: "Ver / decidir" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Detalle del cierre" });
    await expect(dialog).toBeVisible();

    // Snapshot totals panel (R8) with the per-method cash total.
    const totales = dialog.getByRole("region", { name: "Totales del cierre" });
    await expect(totales).toBeVisible();
    await expect(totales.getByText(TOTAL_EFECTIVO)).toBeVisible();

    // Evidence of a rejected order opens via a signed URL in the viewer (R7).
    const rechazadas = dialog.getByRole("region", { name: "Rechazadas" });
    await rechazadas.getByRole("button", { name: "Ver evidencia" }).first().click();
    const visor = page.getByRole("dialog", { name: "Evidencia de la gestión" });
    await expect(
      visor.getByRole("img", { name: "Evidencia fotográfica de la gestión" }),
    ).toBeVisible();
    await visor.getByRole("button", { name: "Cerrar" }).click();

    // Approve the closing (R10).
    await dialog.getByRole("button", { name: "Aprobar" }).click();

    // Success feedback (toast) confirms the decision.
    await expect(page.getByText(/Cierre aprobado/i)).toBeVisible();

    // After router.refresh(), the closing appears in the history as "Aprobado" (R5).
    const historico = page.getByRole("region", { name: "Histórico" });
    await expect(historico.getByText("Aprobado")).toBeVisible();
  });

  test("rechazar exige motivo → con motivo pasa a histórico como Rechazado", async ({
    page,
  }) => {
    const pendientes = page.getByRole("region", {
      name: "Pendientes de decisión",
    });
    await pendientes.getByRole("button", { name: "Ver / decidir" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Detalle del cierre" });
    await expect(dialog).toBeVisible();

    // Open the reject sub-modal (R11).
    await dialog.getByRole("button", { name: "Rechazar" }).click();
    const rechazo = page.getByRole("dialog", { name: "Rechazar cierre" });
    await expect(rechazo).toBeVisible();

    // Confirming with an empty reason is blocked and shows the validation error (R11).
    await rechazo.getByRole("button", { name: "Rechazar cierre" }).click();
    await expect(
      rechazo.getByText("El motivo de rechazo es obligatorio."),
    ).toBeVisible();

    // With a reason, the rejection goes through.
    await rechazo.getByLabel("Motivo del rechazo").fill("Los montos no cuadran");
    await rechazo.getByRole("button", { name: "Rechazar cierre" }).click();

    await expect(page.getByText(/Cierre rechazado/i)).toBeVisible();

    const historico = page.getByRole("region", { name: "Histórico" });
    await expect(historico.getByText("Rechazado")).toBeVisible();
    await expect(historico.getByText("Los montos no cuadran")).toBeVisible();
  });
});
