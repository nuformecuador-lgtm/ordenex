import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Ingreso de bodega por rechazos SLA VISIBLE en cierres" (Feature 102, T14 / R8/R9).
 * A warehouse admin (maestro for the central/GAM warehouse; adminSatelite for a satellite one)
 * opens a closing detail whose rejected orders come from BOTH origins — the SLA cron (Feature 99,
 * `origen_tipo = "escalado_devuelta_sla"`) AND a manual courier rejection (`origen_tipo = "gestion"`) —
 * and sees:
 *  - The "Ingreso de bodega por rechazos" panel now splitting the combined total (Feature 56) into
 *    two subtotals: "Por SLA (cron)" and "Manual (mensajero)" (R8). By construction
 *    `sla + manual === total` (partitioned server-side, R5).
 *  - Each row of the "Rechazadas" section marked with its origin badge — "SLA" for the escalated
 *    one, "Manual" for the courier one (R9) — so every warehouse income is auditable.
 *
 * This is the read-only visibility surface: no money is moved (R16). The subtotal is derived from
 * the immutable history (49/99) + the frozen per-gestión amount (56); it does NOT change if the
 * tariff is edited afterwards (R7).
 *
 * PRECONDITION (seed): at least one `cierre_dia` in state `solicitado` within the admin's scope
 * (destino_tipo = bodega_central for maestro; bodega_satelite + the admin's zona for adminSatelite),
 * with its snapshot totals AND at least TWO `rechazada` gestiones over the same closing:
 *  - one escalated by the SLA cron (a linked `orden_historial_estado` row with
 *    `origen_tipo = "escalado_devuelta_sla"` towards `rechazada`) with a known
 *    `ingreso_bodega_rechazo` amount (SLA subtotal), and
 *  - one manual courier rejection (`origen_tipo = "gestion"`) with its own known
 *    `ingreso_bodega_rechazo` amount (manual subtotal).
 * The expected combined total and the two subtotals are injected below.
 *
 * EXECUTION NOTE:
 * These tests require a running Next.js dev server + a seeded test database (Supabase/Postgres) with
 * the feature 56 snapshot columns and the feature 49/99 history rows, plus a seeded admin whose
 * scope contains the closing above. As with the other e2e specs in this repo (e.g.
 * e2e/cierres-admin.spec.ts, e2e/cierre-dia.spec.ts), there is NO seed+login harness yet, so this
 * spec is WRITTEN but NOT EXECUTED under `pnpm test` / CI. The executable coverage of R9 lives in
 * the component test tests/components/CierresAdminModule.test.tsx ("feature 102/R8" and
 * "feature 102/R9"). This spec is ready to run once the harness exists.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed a maestro/adminSatelite and a courier closing in `solicitado` with the two rejected
 *    gestiones (SLA + manual) described above; set the seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded admin credentials (would come from test config / a user factory).
const ADMIN_EMAIL = "maestro@example.com";
const ADMIN_PASSWORD = "correct-password";

// Expected amounts (₡ prefix added by the UI) of the seeded closing's rejected orders.
const TOTAL_INGRESO_BODEGA = "₡9200.00"; // combined total (Feature 56 snapshot)
const SUBTOTAL_SLA = "₡6000.00"; // escalated by the SLA cron (99)
const SUBTOTAL_MANUAL = "₡3200.00"; // manual courier rejection

/** Logs in as the seeded admin and lands on the app. */
async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Cierres del día — el desglose SLA/manual del ingreso de bodega por rechazos", () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/cierres-admin");
  });

  test("R8/R9: el detalle separa el subtotal SLA del manual y marca cada fila rechazada", async ({
    page,
  }) => {
    // Open the full detail of the first pending closing.
    const pendientes = page.getByRole("region", {
      name: "Pendientes de decisión",
    });
    await expect(pendientes).toBeVisible();
    await pendientes.getByRole("button", { name: "Ver / decidir" }).first().click();

    const dialog = page.getByRole("dialog", { name: "Detalle del cierre" });
    await expect(dialog).toBeVisible();

    // R8: the "Ingreso de bodega por rechazos" panel shows the combined total AND the two
    // subtotals split by origin (SLA cron vs manual courier). sla + manual === total (R5).
    const ingreso = dialog.getByRole("region", {
      name: "Ingreso de bodega por rechazos del cierre",
    });
    await expect(ingreso).toBeVisible();
    await expect(ingreso.getByText(TOTAL_INGRESO_BODEGA)).toBeVisible();
    await expect(ingreso.getByText("Por SLA (cron)")).toBeVisible();
    await expect(ingreso.getByText(SUBTOTAL_SLA)).toBeVisible();
    await expect(ingreso.getByText("Manual (mensajero)")).toBeVisible();
    await expect(ingreso.getByText(SUBTOTAL_MANUAL)).toBeVisible();

    // R9: each rejected row is marked with its origin badge (SLA vs Manual), so the origin of
    // every warehouse income is auditable.
    const rechazadas = dialog.getByRole("region", { name: "Rechazadas" });
    await expect(rechazadas).toBeVisible();
    await expect(rechazadas.getByText("SLA", { exact: true })).toBeVisible();
    await expect(rechazadas.getByText("Manual", { exact: true })).toBeVisible();
  });
});
