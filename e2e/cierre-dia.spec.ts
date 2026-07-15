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

/**
 * Feature 64 (T21, R35–R38) — el mensajero DESHACE una gestión errónea antes de
 * solicitar el cierre: la gestión se anula (con rastro) y su orden vuelve a
 * `en_reparto` con él, lista para re-gestionar.
 *
 * Happy path del flujo crítico (toca recaudo: la fila sale de los totales del día):
 *  mensajero en /cierre-dia → la orden entregada aparece en "Entregadas" y suma al
 *  total → "Devolver a gestión" en SU fila → confirma en el modal → toast de éxito,
 *  la fila desaparece de la tabla, el total baja y la orden reaparece en
 *  /mis-asignaciones como `en_reparto` (lista para "Escoger para gestión": el
 *  deshacer NO repone el puntero `orden_en_gestion_id`, F1.4-c/R29).
 *
 * PRECONDICIÓN (seed), además de la del bloque de arriba: la gestión `entregada` de
 * la orden ORDEN_A_DESHACER debe seguir DENTRO de la ventana (`cierre_id IS NULL`,
 * o sea sin cierre solicitado todavía) y ser la más reciente NO anulada de su orden
 * (R4), con la orden aún en `entregada` (R5: si la bodega ya la movió, el server
 * responde `conflict` y este test debe fallar, que es lo correcto).
 *
 * Mismo diferimiento de ejecución que el bloque de arriba: escrito, NO ejecutado
 * hasta que exista el entorno con DB real. NO corre bajo `pnpm test`.
 */

// Nº de remisión y destinatario de la entrega seeded que se va a deshacer: componen
// el nombre accesible del botón de SU fila (`aria-label`, R35).
const ORDEN_A_DESHACER = "REM-001";
const DESTINATARIO_A_DESHACER = "Ana Pérez";
const BOTON_DESHACER = `Devolver a gestión la orden ${ORDEN_A_DESHACER} · ${DESTINATARIO_A_DESHACER}`;

// Total de efectivo esperado DESPUÉS de deshacer la entrega (R37: los totales se
// recalculan sin ella). Seed: TOTAL_EFECTIVO menos el monto de esa entrega.
const TOTAL_EFECTIVO_TRAS_DESHACER = "₡50.00";

test.describe("Cierre del día — mensajero deshace una gestión (feature 64)", () => {
  test.beforeEach(async ({ page }) => {
    await loginMensajero(page);
    await page.goto("/cierre-dia");
  });

  test("Devolver a gestión → confirma → la fila sale de la tabla, el total baja y la orden vuelve a 'en reparto'", async ({
    page,
  }) => {
    // La entrega errónea está listada en "Entregadas" y suma al total del día.
    const entregadas = page.getByRole("region", { name: "Entregadas" });
    await expect(entregadas.getByText(ORDEN_A_DESHACER)).toBeVisible();
    const totales = page.getByRole("region", { name: "Totales del día" });
    await expect(totales.getByText(TOTAL_EFECTIVO)).toBeVisible();

    // R35: la acción vive en SU fila, con nombre accesible que identifica la orden.
    const deshacer = entregadas.getByRole("button", { name: BOTON_DESHACER });
    await expect(deshacer).toBeEnabled();
    await deshacer.click();

    // R36: confirmación explícita antes de ejecutar; avisa del rastro que queda.
    const dialog = page.getByRole("dialog", { name: "Devolver la orden a gestión" });
    await expect(dialog).toContainText(/quedará anulada/i);
    await dialog.getByRole("button", { name: "Devolver a gestión" }).click();

    // R37: éxito → la vista relee el servidor (router.refresh()): la fila desaparece
    // de su tabla y los totales se recalculan SIN ella.
    await expect(page.getByText(/Gestión deshecha/i)).toBeVisible();
    await expect(entregadas.getByText(ORDEN_A_DESHACER)).toBeHidden();
    await expect(totales.getByText(TOTAL_EFECTIVO_TRAS_DESHACER)).toBeVisible();

    // R18/R19/R31: la orden volvió a `en_reparto` asignada al mismo mensajero, así que
    // reaparece en su lista por gestionar y puede volver a escogerla (guardia 1-a-1).
    await page.goto("/mis-asignaciones");
    const porGestionar = page.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    await expect(porGestionar.getByText(ORDEN_A_DESHACER)).toBeVisible();
  });
});
