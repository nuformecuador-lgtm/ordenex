import { test, expect, type Page } from "@playwright/test";

/**
 * E2E — Rechazo: devolución a la tienda de origen
 * (Feature 48, T13 — flujo crítico R1/R4/R12/R15).
 *
 * Cubre el RETORNO de una orden `rechazada` a su tienda de origen:
 *  - R1/R4: una orden que reposa en `rechazada` (por escalado 47 o rechazo directo
 *    36) es elegible; la BODEGA RESPONSABLE ejecuta "Devolver a la tienda" y la
 *    orden transiciona `rechazada → devuelta_origen`.
 *  - R10: sólo el administrador de la bodega responsable puede ejecutar el retorno
 *    (maestro/admin para zona central; adminSatelite para su zona).
 *  - R12/R13: el `adminTienda` dueño ve la orden `devuelta_origen` en su módulo con
 *    la etiqueta legible "Devuelta a origen" (nunca el value crudo).
 *  - R15: la línea de tiempo de la orden (feature 49) muestra la transición
 *    `rechazada → devuelta_origen` como una entrada más (etiqueta legible).
 *
 * SUPERFICIE (verificada en el código, features 48/49):
 *  - BODEGA CENTRAL (maestro/admin): `/ordenes` (revisión por apartados) → region
 *    "Rechazadas" → seleccionar la orden (de zona CENTRAL) → botón "Devolver a la
 *    tienda" → modal role="dialog" name="Devolver a la tienda" → confirmar
 *    ("Devolver a la tienda"). La orden pasa a `devuelta_origen` y aparece en la
 *    region de solo lectura "Devueltas a origen".
 *  - BODEGA SATÉLITE (adminSatelite): `/recepcion-satelite` → region "Por devolver
 *    a tienda" → cada fila con botón "Devolver a la tienda" (acota por zona).
 *  - VISUALIZACIÓN (adminTienda dueño de la tienda, ve la orden en cualquier estado,
 *    feature 49/R27): `/ordenes` (listado plano) → columna "Estatus" con el badge
 *    "Devuelta a origen"; fila con `aria-label="Ver historial de la orden <remisión>"`
 *    (HistorialOrdenSheet) → Sheet role="dialog" name="Historial de la orden
 *    <remisión>" cuya `<ol aria-label="Línea de tiempo de estados">` incluye un
 *    `<li>` "Rechazada → Devuelta a origen".
 *
 * PRECONDITION (seed):
 * - Un `maestro`/admin de la bodega central: MAESTRO_EMAIL / MAESTRO_PASSWORD.
 * - Un `adminTienda` dueño de la tienda de la orden (ve la orden en cualquier
 *   estado en el listado plano de `/ordenes`, feature 49/R27):
 *   ADMIN_TIENDA_EMAIL / ADMIN_TIENDA_PASSWORD.
 * - Una orden de esa tienda con numRemisión = REMISION, en estado `rechazada` y de
 *   zona CENTRAL (para que la devuelva la bodega central; una orden satélite la
 *   devolvería el adminSatelite desde `/recepcion-satelite`).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev).
 * - A test database with Supabase/Postgres and the feature 49 migration applied,
 *   plus the order-status catalog seeded (incl. `rechazada`, `devuelta_origen`).
 * - The seeded maestro and adminTienda users, and the order in `rechazada` per
 *   PRECONDITION above.
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/reintentos-escalado.spec.ts, e2e/historial-orden.spec.ts,
 * e2e/mis-asignaciones.spec.ts and e2e/reprogramacion-liberacion.spec.ts). They do
 * NOT run under `pnpm test` (vitest only includes `tests/**`, and this spec imports
 * from `@playwright/test`).
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials.
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed the maestro and adminTienda users and the order in `rechazada` (zona
 *    central) per PRECONDITION; set the constants below.
 * 4. Run tests: pnpm run test:e2e
 */

// Maestro/bodega central admin that executes the return.
const MAESTRO_EMAIL = "maestro@example.com";
const MAESTRO_PASSWORD = "correct-password";

// AdminTienda that OWNS the order's tienda (sees it in any state, feature 49/R27).
const ADMIN_TIENDA_EMAIL = "admin.tienda@example.com";
const ADMIN_TIENDA_PASSWORD = "correct-password";

// Seed order: numRemisión (the row's readable key used in the button/title).
const REMISION = "REM-SEED-RECHAZADA";

// Readable state labels (via estatus-label) shown in the timeline / badge (R13/R15).
const LABEL_RECHAZADA = "Rechazada";
const LABEL_DEVUELTA_ORIGEN = "Devuelta a origen";

// Accessible names derivados de HistorialOrdenSheet.tsx (selectores reales).
const TRIGGER_NAME = `Ver historial de la orden ${REMISION}`;
const DIALOG_TITLE = `Historial de la orden ${REMISION}`;

// Ningún UUID/value crudo debe aparecer en la línea de tiempo (R13/R30).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Inicia sesión con el usuario dado y aterriza en la app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

/** Cierra sesión para intercalar actores (maestro ↔ adminTienda). */
async function logout(page: Page) {
  await page.getByRole("button", { name: /Cerrar sesión/i }).click();
  await page.waitForURL(/\/login/, { timeout: 5000 });
}

test.describe.serial("Devolución a la tienda de origen — rechazada → devuelta_origen (R1/R4/R12/R15)", () => {
  test("la bodega central devuelve una orden rechazada de zona central", async ({
    page,
  }) => {
    await login(page, MAESTRO_EMAIL, MAESTRO_PASSWORD);
    await page.goto("/ordenes");

    // R4/R10 — apartado "Rechazadas": seleccionar la orden y devolverla.
    const rechazadas = page.getByRole("region", { name: "Rechazadas" });
    await expect(rechazadas).toBeVisible();
    const fila = rechazadas.getByRole("row", { name: new RegExp(REMISION) });
    await fila.getByRole("checkbox").check();
    await rechazadas
      .getByRole("button", { name: "Devolver a la tienda" })
      .click();

    const modal = page.getByRole("dialog", { name: "Devolver a la tienda" });
    await expect(modal).toBeVisible();
    await expect(modal.getByText(new RegExp(REMISION))).toBeVisible();
    await modal.getByRole("button", { name: "Devolver a la tienda" }).click();
    await expect(modal).toBeHidden();

    // R14 — la orden aparece en el apartado de solo lectura "Devueltas a origen".
    const devueltas = page.getByRole("region", { name: "Devueltas a origen" });
    await expect(devueltas.getByText(new RegExp(REMISION))).toBeVisible();
    await logout(page);
  });

  test("el adminTienda ve la orden con etiqueta 'Devuelta a origen' y el historial muestra la transición", async ({
    page,
  }) => {
    await login(page, ADMIN_TIENDA_EMAIL, ADMIN_TIENDA_PASSWORD);
    await page.goto("/ordenes");

    // R12/R13 — la orden aparece en el listado plano de la tienda con la etiqueta
    // legible "Devuelta a origen" (nunca el value crudo).
    const fila = page.getByRole("row", { name: new RegExp(REMISION) });
    await expect(fila).toBeVisible();
    await expect(fila.getByText(LABEL_DEVUELTA_ORIGEN)).toBeVisible();

    // R15 — la línea de tiempo incluye la transición rechazada → devuelta_origen.
    await page.getByRole("button", { name: TRIGGER_NAME }).click();
    const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
    await expect(dialog).toBeVisible();

    const timeline = dialog.getByRole("list", {
      name: "Línea de tiempo de estados",
    });
    await expect(timeline).toBeVisible();
    await expect(dialog.getByText(UUID_RE)).toHaveCount(0);

    // La ÚLTIMA entrada es el retorno: origen "Rechazada" → destino "Devuelta a origen".
    const ultima = timeline.getByRole("listitem").last();
    await expect(ultima.getByText(LABEL_RECHAZADA)).toBeVisible();
    await expect(ultima.getByText(LABEL_DEVUELTA_ORIGEN)).toBeVisible();
  });
});
