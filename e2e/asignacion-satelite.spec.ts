import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Asignación satélite" — adminSatelite assigns received orders to
 * couriers of their own zone (Feature 34, T11 / R18, F1.4 decisión (f)).
 *
 * Covers the critical happy path of the satellite-warehouse assignment:
 *  Happy path: adminSatelite logs in → /recepcion-satelite → in the "Recibidas"
 *  region selects one or more orders (state `en_bodega_satelite`, of their zone)
 *  via the per-row checkbox → clicks "Asignar" → picks a courier of their zone in
 *  the modal Select → confirms → the batch transitions
 *  `en_bodega_satelite` → `por_recoger` and a success toast is shown.
 *
 * MANUAL VERIFICATION (not automatable here):
 *  - The downstream consumption by the courier module (feature 36, "Recoger" →
 *    `en_reparto`) is verified by e2e/mis-asignaciones.spec.ts and manually; this
 *    spec stops at `por_recoger` (the boundary of feature 34, R17).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres and the `en_bodega_satelite` and
 *   `por_recoger` catalog values seeded (features 33/17 migrations applied)
 * - A seeded `adminSatelite` user WITH a `zonaId`, at least one order already in
 *   `en_bodega_satelite` in that same zone (so "Recibidas" is non-empty), and at
 *   least one `mensajero` user in that same zone (so the modal Select is non-empty)
 * - The `orden.numRemision` of that seeded order, injected as ORDEN_REMISION below,
 *   and the courier display name, injected as MENSAJERO_NOMBRE below
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/auth.spec.ts, e2e/mis-asignaciones.spec.ts and
 * e2e/recepcion-satelite.spec.ts). They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed an adminSatelite (with zona), an order in en_bodega_satelite of that
 *    zona and a mensajero of that zona; set ORDEN_REMISION and MENSAJERO_NOMBRE
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded adminSatelite credentials (would come from test config / a user factory).
const ADMIN_SATELITE_EMAIL = "admin-satelite@example.com";
const ADMIN_SATELITE_PASSWORD = "correct-password";

// Remisión (visible label) of a seeded order in `en_bodega_satelite` of the actor's zone.
const ORDEN_REMISION = "REM-SEED-BODEGA-SATELITE";
// Display name of a seeded `mensajero` of the actor's zone.
const MENSAJERO_NOMBRE = "Mensajero Seed Zona";

/** Logs in as the seeded adminSatelite and lands on the app. */
async function loginAdminSatelite(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_SATELITE_EMAIL);
  await page.fill('input[type="password"]', ADMIN_SATELITE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Asignación satélite — asignar mensajero de la zona", () => {
  test.beforeEach(async ({ page }) => {
    await loginAdminSatelite(page);
    // Feature 279 (T6.1, 2026-08-24): el portal del `adminSatelite` se partió en dos
    // rutas y `/recepcion-satelite` sólo redirige. Se apunta a la pantalla que este
    // caso describe. **No se afirma que este spec pase**: los e2e de este repo siguen
    // sin ejecutarse (ver la cabecera del archivo), así que esto es una corrección de
    // ruta por lectura, no una verificación.
    await page.goto("/recepcion-satelite/en-bodega");
  });

  test("seleccionar orden recibida → Asignar mensajero → por_recoger", async ({
    page,
  }) => {
    // The "Recibidas" region lists orders in `en_bodega_satelite` of the zone.
    const recibidas = page.getByRole("region", { name: "Recibidas" });
    await expect(recibidas).toBeVisible();

    // The batch "Asignar" action starts disabled (no selection yet).
    const asignar = recibidas.getByRole("button", { name: "Asignar" });
    await expect(asignar).toBeDisabled();

    // Select the seeded received order via its per-row checkbox.
    const checkbox = recibidas.getByRole("checkbox", {
      name: `Seleccionar ${ORDEN_REMISION}`,
    });
    await checkbox.check();
    await expect(asignar).toBeEnabled();

    // Open the assignment modal and pick a courier of the zone.
    await asignar.click();
    const select = page.getByRole("combobox", { name: "Mensajero para el lote" });
    await select.click();
    await page
      .getByRole("option", { name: MENSAJERO_NOMBRE })
      .click();

    // Confirm the assignment.
    const modal = page.getByRole("dialog", { name: "Asignar mensajero" });
    await page.getByRole("button", { name: "Asignar" }).last().click();

    // Success feedback (toast) confirms the batch transition. Feature 148 (§9.7):
    // the SAME summary string now also renders inside the modal's "resultado"
    // phase, so the toast assertion is scoped to the toast viewport region
    // ("Notificaciones") to keep it unambiguous under Playwright strict mode.
    // Without the scope this resolves to 2 elements and fails.
    const notificaciones = page.getByRole("region", { name: "Notificaciones" });
    await expect(notificaciones.getByText(/Mensajero asignado a/i)).toBeVisible();

    // Feature 148 (§9.7): the modal no longer closes on confirm. It switches to the
    // "resultado" phase, which repeats the summary and offers the batch manifest.
    await expect(modal).toBeVisible();
    await expect(modal.getByText(/Mensajero asignado a/i)).toBeVisible();
    await expect(
      modal.getByRole("button", { name: /Descargar manifiesto/i }),
    ).toBeVisible();

    // The parent's refresh (router.refresh) is deferred to the CLOSING of that
    // phase — that is the real user journey now. Closing it here keeps the next
    // assertion measuring the state transition and not the modal's aria-hidden
    // backdrop.
    await modal.getByRole("button", { name: "Cerrar" }).click();
    await expect(modal).toBeHidden();

    // After router.refresh(), the order left "Recibidas" (now por_recoger),
    // so it is no longer selectable there.
    await expect(
      recibidas.getByRole("checkbox", {
        name: `Seleccionar ${ORDEN_REMISION}`,
      }),
    ).toHaveCount(0);
  });
});
