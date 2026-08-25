import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Reglas y bloqueos de cierre" — the critical money/recaudo path of
 * Feature 41 (G3 / R6, R12–R15, R18, R19–R22). It ties together the three existing
 * screens (mensajero's "Cierre del día", adminSatelite's "Recepción satélite" and the
 * warehouse admin's "Cierres del día") around a `cierre_dia` in the NEW `vencido`
 * state that the daily cut-off (`/api/cron/corte-diario`) produced.
 *
 * Covers the full critical path (all steps chained, DB-mutating, hence serial):
 *  1. Corte crea vencido (seed precondition): the daily cut-off already ran, so a
 *     courier with unclosed activity now has a `cierre_dia estado='vencido'` within
 *     the admin's scope (R6/R7/R8).
 *  2. Mensajero bloqueado: the courier's "Cierre del día" view shows the actionable
 *     block notice (role="alert") — feature 111/R12 makes the block TOTAL: they cannot
 *     gestionar NOR receive new assignments.
 *  3. Asignación rechazada: the adminSatelite's "Recepción satélite" view shows the
 *     warehouse-blocked notice (differentiated cause) and the "Asignar" action is
 *     disabled, so the satellite cannot assign to its couriers (R14/R18/R22; the
 *     maestro path R13 is the same derived block on `generarGuia`/`asignarDesdeBodega`).
 *  4. Admin destraba (válvula, feature 111/R15/R16): in `/cierres-admin` the `vencido`
 *     shows differentiated (a "Vencido" badge) but is NO LONGER directly approvable
 *     (R15). The admin uses the exception action "Destrabar cierre vencido"
 *     (vencido → solicitado) and then approves it as `solicitado` via the feature-38 flow.
 *  5. Desbloqueo: once the `vencido` is resolved, the courier is no longer blocked
 *     (their alert is gone) and the satellite can assign again (block notice gone,
 *     "Asignar" enabled) (R15).
 *
 * PRECONDITION (seed):
 * - A `mensajero` M WITH a `zonaId` that belongs to a SATELLITE zone Z (not the
 *   central one), with at least one `gestion_orden` managed during the day and left
 *   with `cierre_id IS NULL`, and NO `cierre_dia` in state `solicitado`. Running the
 *   daily cut-off once (or seeding the row directly) leaves exactly one `cierre_dia`
 *   for M with `estado='vencido'`, `destino_tipo='bodega_satelite'`,
 *   `destino_zona_id=Z`, its per-method totals/pago snapshotted and its gestiones
 *   linked (R6/R8) — this is the ONLY blocking closing for M (R12) and the (i) cause
 *   of the satellite block for Z (R17).
 * - An `adminSatelite` A whose `zonaId = Z`, with at least one order already in
 *   `en_bodega_satelite` of Z (so "Recibidas" is non-empty and selectable), and NO
 *   own `cierre_bodega` in `estado='solicitado'` (so the satellite block comes ONLY
 *   from cause (i), the courier's `vencido`, and disappears once it is resolved).
 * - A warehouse admin who resolves Z's closings: the `adminSatelite` A itself (its
 *   `/cierres-admin` scope is its own zone Z), so the SAME login used for step 3 sees
 *   and resolves the `vencido` in step 4. Set NUM_REMISION to the seeded received
 *   order so the "Recibidas" checkbox can be targeted by its accessible name.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres, the `cierre_dia` table with the feature 41
 *   `vencido` enum value + `(mensajero_id, estado)` index migration applied, and the
 *   gestion/order catalog values seeded
 * - The seeded mensajero (with a satellite zona) carrying a `vencido`, and the
 *   adminSatelite of that same zona with a received order, per PRECONDITION above
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/cierres-admin.spec.ts, e2e/cierre-dia.spec.ts and
 * e2e/recepcion-satelite.spec.ts). They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials (incl. CRON_SECRET)
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed M (mensajero of satellite zona Z, with unclosed activity) and A
 *    (adminSatelite of Z, with a received order); trigger the cut-off (GET
 *    /api/cron/corte-diario with the CRON_SECRET) so M gets a `vencido`; set the
 *    seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded mensajero (blocked by the `vencido` produced by the cut-off).
const MENSAJERO_EMAIL = "mensajero-vencido@example.com";
const MENSAJERO_PASSWORD = "correct-password";

// Seeded adminSatelite of the SAME satellite zona (resolves the `vencido` in its
// own `/cierres-admin` scope, and is blocked from assigning while it is pending).
const ADMIN_SATELITE_EMAIL = "admin-satelite@example.com";
const ADMIN_SATELITE_PASSWORD = "correct-password";

// numRemision of a seeded order already `en_bodega_satelite` of the zona (targets the
// "Recibidas" selection checkbox by its accessible name "Seleccionar <numRemision>").
const NUM_REMISION = "REM-SAT-0001";

/** Logs in with the given credentials and lands on the app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

// Serial: the path mutates real state (approving the `vencido` desbloquea M and Z),
// so step 5 depends on step 4 having run.
test.describe.serial("Reglas y bloqueos de cierre — camino crítico del vencido", () => {
  test("paso 2 — el mensajero con `vencido` ve el aviso accionable de bloqueo (R21)", async ({
    page,
  }) => {
    // Precondition (seed): the cut-off already created M's `vencido` (paso 1, R6/R8).
    await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
    await page.goto("/cierre-dia");

    // R12/R21: derived block surfaced as an actionable alert on the courier's view.
    const aviso = page.getByRole("alert").filter({
      hasText:
        "No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente.",
    });
    await expect(aviso).toBeVisible();
  });

  test("paso 3 — la bodega satélite bloqueada rechaza la asignación: aviso + 'Asignar' deshabilitado (R18/R22)", async ({
    page,
  }) => {
    await login(page, ADMIN_SATELITE_EMAIL, ADMIN_SATELITE_PASSWORD);
    // Feature 279 (T6.1, 2026-08-24): el portal del `adminSatelite` se partió en dos
    // rutas y `/recepcion-satelite` sólo redirige. Se apunta a la pantalla que este
    // caso describe. **No se afirma que este spec pase**: los e2e de este repo siguen
    // sin ejecutarse (ver la cabecera del archivo), así que esto es una corrección de
    // ruta por lectura, no una verificación.
    await page.goto("/recepcion-satelite/en-bodega");

    const recibidas = page.getByRole("region", { name: "Recibidas" });
    await expect(recibidas).toBeVisible();

    // R22: warehouse-blocked notice, differentiated cause (i) = couriers' closings.
    const aviso = recibidas.getByRole("alert").filter({
      hasText:
        "No puedes asignar órdenes: tu bodega tiene cierres pendientes de resolver.",
    });
    await expect(aviso).toBeVisible();
    await expect(
      aviso.getByText("Resuelve los cierres pendientes de tus mensajeros."),
    ).toBeVisible();

    // R14/R18: selecting a received order does NOT enable assignment while blocked.
    await recibidas
      .getByRole("checkbox", { name: `Seleccionar ${NUM_REMISION}` })
      .check();
    await expect(recibidas.getByRole("button", { name: "Asignar" })).toBeDisabled();
  });

  test("paso 4 — el admin destraba el `vencido` (válvula R16) y lo aprueba ya como `solicitado` (R15)", async ({
    page,
  }) => {
    // Same adminSatelite: its `/cierres-admin` scope is its own zona Z.
    await login(page, ADMIN_SATELITE_EMAIL, ADMIN_SATELITE_PASSWORD);
    await page.goto("/cierres-admin");

    // R20: the `vencido` sits in the pending-decision queue, differentiated by a
    // "Vencido" badge (vs "Solicitado").
    const pendientes = page.getByRole("region", {
      name: "Pendientes de decisión",
    });
    await expect(pendientes).toBeVisible();
    await expect(pendientes.getByText("Vencido")).toBeVisible();

    // Feature 111/R15: el `vencido` YA NO es aprobable directo por la vía normal. La vía
    // de EXCEPCIÓN de la bodega para destrabar un vencido abandonado es la válvula (R16):
    // "Destrabar cierre vencido" (con confirmación), que lo transiciona `vencido → solicitado`
    // en nombre del mensajero, sin recalcular montos (R21).
    await pendientes
      .getByRole("button", { name: /Destrabar cierre vencido/ })
      .first()
      .click();
    const confirmDestrabar = page.getByRole("dialog", {
      name: "Destrabar cierre vencido abandonado",
    });
    await expect(confirmDestrabar).toBeVisible();
    await confirmDestrabar
      .getByRole("button", { name: "Destrabar (excepción)" })
      .click();
    await expect(
      page.getByText(/Cierre vencido destrabado; quedó como solicitado/i),
    ).toBeVisible();

    // Ya `solicitado`: ahora sí se resuelve por la vía normal (feature 38). Abrir el
    // detalle (totales = snapshot congelado, R8 — no se recalcula) y aprobar.
    await pendientes.getByRole("button", { name: "Ver / decidir" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Detalle del cierre" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Totales del cierre" })).toBeVisible();
    await dialog.getByRole("button", { name: "Aprobar" }).click();

    // Success feedback + the closing lands in the read-only history as "Aprobado".
    await expect(page.getByText(/Cierre aprobado/i)).toBeVisible();
    const historico = page.getByRole("region", { name: "Histórico" });
    await expect(historico.getByText("Aprobado")).toBeVisible();
  });

  test("paso 5 — tras resolver, el mensajero se desbloquea y la bodega puede asignar (R15)", async ({
    page,
  }) => {
    // The courier no longer sees the block alert (R15).
    await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
    await page.goto("/cierre-dia");
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente.",
      }),
    ).toHaveCount(0);

    // The satellite is unblocked: no warehouse-blocked notice, and selecting a
    // received order enables "Asignar" again (R15/R22).
    await login(page, ADMIN_SATELITE_EMAIL, ADMIN_SATELITE_PASSWORD);
    // Feature 279 (T6.1, 2026-08-24): el portal del `adminSatelite` se partió en dos
    // rutas y `/recepcion-satelite` sólo redirige. Se apunta a la pantalla que este
    // caso describe. **No se afirma que este spec pase**: los e2e de este repo siguen
    // sin ejecutarse (ver la cabecera del archivo), así que esto es una corrección de
    // ruta por lectura, no una verificación.
    await page.goto("/recepcion-satelite/en-bodega");
    const recibidas = page.getByRole("region", { name: "Recibidas" });
    await expect(
      recibidas.getByRole("alert").filter({
        hasText:
          "No puedes asignar órdenes: tu bodega tiene cierres pendientes de resolver.",
      }),
    ).toHaveCount(0);

    await recibidas
      .getByRole("checkbox", { name: `Seleccionar ${NUM_REMISION}` })
      .check();
    await expect(recibidas.getByRole("button", { name: "Asignar" })).toBeEnabled();
  });
});
