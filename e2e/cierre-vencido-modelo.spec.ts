import { test, expect, type Page } from "@playwright/test";

/**
 * E2E — Feature 111: cierre `vencido`, bloqueo total y resolución POR EL MENSAJERO.
 *
 * Complementa e2e/reglas-bloqueos-cierre.spec.ts (que cubre la VÁLVULA del admin, R16):
 * aquí el propio MENSAJERO resuelve su `vencido` enviándolo a aprobación.
 *  1. Precondición (seed): el corte diario dejó a M con un `cierre_dia estado='vencido'`
 *     (su único cierre bloqueante), igual que reglas-bloqueos-cierre.spec.ts.
 *  2. Bloqueo TOTAL (feature 111/R1/R12/R14): en "Cierre del día" y "Mis asignaciones" M
 *     ve el aviso de bloqueo total (no puede gestionar NI recibir).
 *  3. Solicitar el `vencido` (R6/R13): M usa el CTA "Solicitar aprobación del cierre
 *     vencido" (disponible aunque `puedesSolicitar` sea false) → `vencido → solicitado`
 *     (invariante R10: no crea un segundo cierre).
 *  4. Aprobación normal (feature 38 / R15): el admin ve el `solicitado` (ya NO un
 *     `vencido`) y lo aprueba por la vía normal.
 *  5. Desbloqueo (R18): resuelto el cierre, M deja de estar bloqueado.
 *
 * PRECONDICIÓN (seed): igual que e2e/reglas-bloqueos-cierre.spec.ts — un mensajero M de
 * una zona satélite Z con un `vencido` (su único cierre bloqueante), y el adminSatelite A
 * de Z que lo aprueba en su `/cierres-admin`.
 *
 * NO SE EJECUTA todavía (emails placeholder / sin DB de test — misma deferral que el
 * resto de los e2e/*.spec.ts: no corren bajo `pnpm test`). Escrito para ejecutarse
 * cuando exista el harness E2E (seed + login por rol).
 */

const MENSAJERO_EMAIL = "mensajero-vencido@example.com";
const MENSAJERO_PASSWORD = "correct-password";
const ADMIN_SATELITE_EMAIL = "admin-satelite@example.com";
const ADMIN_SATELITE_PASSWORD = "correct-password";

// Feature 111/R12: aviso de bloqueo TOTAL (gestionar + recibir) en la vista del mensajero.
const BLOQUEO_TOTAL_TEXT =
  "No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente.";

/** Inicia sesión con las credenciales dadas y aterriza en la app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

// Serial: muta estado real (aprobar el cierre desbloquea a M), así que el paso 5
// depende de que el 4 haya corrido.
test.describe.serial(
  "Feature 111 — el mensajero solicita y resuelve su cierre vencido",
  () => {
    test("paso 2 — bloqueo TOTAL: el mensajero con `vencido` ve el aviso (R1/R12/R14)", async ({
      page,
    }) => {
      await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);

      await page.goto("/cierre-dia");
      await expect(
        page.getByRole("alert").filter({ hasText: BLOQUEO_TOTAL_TEXT }),
      ).toBeVisible();

      // R14: el mismo bloqueo total se refleja en "Mis asignaciones".
      await page.goto("/mis-asignaciones");
      await expect(
        page.getByRole("alert").filter({ hasText: BLOQUEO_TOTAL_TEXT }),
      ).toBeVisible();
    });

    test("paso 3 — el mensajero solicita su `vencido` → `solicitado` (R6/R13)", async ({
      page,
    }) => {
      await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
      await page.goto("/cierre-dia");

      // R13: CTA diferenciado del vencido, disponible con independencia de `puedesSolicitar`.
      await page
        .getByRole("button", { name: "Solicitar aprobación del cierre vencido" })
        .click();
      const confirm = page.getByRole("dialog", {
        name: "Solicitar aprobación del cierre vencido",
      });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Solicitar aprobación" }).click();

      // R6: transición `vencido → solicitado` (sin recalcular los montos ya snapshoteados).
      await expect(
        page.getByText(/Cierre vencido enviado a aprobación/i),
      ).toBeVisible();
    });

    test("paso 4 — el admin aprueba el `solicitado` (ya no un `vencido`) por la vía normal (feature 38/R15)", async ({
      page,
    }) => {
      await login(page, ADMIN_SATELITE_EMAIL, ADMIN_SATELITE_PASSWORD);
      await page.goto("/cierres-admin");

      const pendientes = page.getByRole("region", {
        name: "Pendientes de decisión",
      });
      await expect(pendientes).toBeVisible();
      // Aparece como `Solicitado` (lo envió el mensajero), no `Vencido`.
      await expect(pendientes.getByText("Solicitado")).toBeVisible();

      await pendientes
        .getByRole("button", { name: "Ver / decidir" })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "Detalle del cierre" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Aprobar" }).click();
      await expect(page.getByText(/Cierre aprobado/i)).toBeVisible();
    });

    test("paso 5 — tras la aprobación, el mensajero se desbloquea (R18)", async ({
      page,
    }) => {
      await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
      await page.goto("/cierre-dia");
      await expect(
        page.getByRole("alert").filter({ hasText: BLOQUEO_TOTAL_TEXT }),
      ).toHaveCount(0);
    });
  },
);
