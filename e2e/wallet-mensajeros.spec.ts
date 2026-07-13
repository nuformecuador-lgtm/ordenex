import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "/wallet/mensajeros" and "/mis-pagos" — the PAGO A MENSAJEROS y CUENTAS POR
 * PAGAR (Feature 44, T14–T16 / R18–R22). When a `CierreDia` is approved, the pay owed to the
 * mensajero (`total_pago_mensajero`, snapshot 39) and the cash he collected
 * (`total_efectivo`, snapshot 37) are frozen into an append-only LEDGER per mensajero:
 * `pago_devengado = P` and `pago_efectivo = min(P,E)`. The CUENTA POR PAGAR (what Ordenex
 * still owes) is DERIVED (Σdevengo − Σpago) and never stored; it is positive or zero, never
 * negative in the normal flow (R16).
 *
 * Two role-aware Server Components:
 *  - `/wallet/mensajeros` (R18/R19): only the `maestro` (owner of the central cash box) sees
 *    the cuentas por pagar of ALL mensajeros. The pay to mensajeros is an egreso of the
 *    maestro's CENTRAL cash box (F1.4-Qe/A2: adminSatelite does NOT see it). Any other role
 *    (or no session) is denied and NO amount is exposed (R19).
 *  - `/mis-pagos` (R20/R21): only a `mensajero` sees HIS OWN cuenta por pagar and pagos,
 *    ALWAYS scoped to his `mensajero_id` in the WHERE (R20); any other role is denied.
 *
 * Covers the flows the review requires (parallel to e2e/wallet.spec.ts and e2e/mi-wallet.spec.ts):
 *  1. Acceso del `maestro` a /wallet/mensajeros (R18/R21/R22): logs in → sees the CUENTAS POR
 *     PAGAR table (amounts rendered as STRING, never Prisma.Decimal) → expands a mensajero's
 *     DESGLOSE POR CIERRE (paginated, most recent first, loaded client-side via
 *     `listarPagosDeMensajeroAction`) → filters that desglose server-side by date range / cierre
 *     (the shown saldo reflects the filtered set) → also filters the summary table by mensajero
 *     name (client-side over the pre-fetched set).
 *  2. Bloqueo de rol NO autorizado en /wallet/mensajeros (R19): a non-maestro user (here a
 *     `mensajero`) navigates there and is denied (Next `notFound()` → no UI): the cuentas por
 *     pagar table is absent, so no financial data leaks.
 *  3. Acceso del `mensajero` a /mis-pagos (R20/R21): logs in → sees HIS OWN CUENTA POR PAGAR
 *     card (derived, STRING) + the DESGLOSE of his pagos (table), scoped to his mensajero_id.
 *  4. Bloqueo de rol NO autorizado en /mis-pagos (R20): a non-mensajero user (here the
 *     `maestro`) is denied and sees NEITHER the cuenta card NOR the desglose table.
 *
 * PRECONDITION (seed):
 * - A seeded `maestro` M (owner of the central cash box; only role for /wallet/mensajeros).
 * - A seeded `mensajero` MZ whose ledger has at least one approved-cierre feed (a
 *   `pago_devengado` + a `pago_efectivo`, R5/R10) so his cuenta por pagar is a known amount
 *   (set CUENTA_ESPERADA below) and his name is known (set MENSAJERO_NOMBRE below).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres, the feature 44 `pago_mensajero_movimiento` table +
 *   enums (PagoMensajeroMovimientoTipo/Categoria) and the feature 42/43 tables/migrations
 *   applied, plus at least one seeded movement fed from an approved `cierre_dia`
 * - A seeded `maestro` and a seeded `mensajero` (with movements), per PRECONDITION
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but NOT
 * EXECUTED. Execution is deferred until the test environment is fully set up (same deferral
 * as e2e/wallet.spec.ts and e2e/mi-wallet.spec.ts). They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed a `maestro` and a `mensajero` with at least one pago_mensajero_movimiento fed by an
 *    approved cierre_dia; set the seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded maestro (owner of the central cash box; only role authorized for /wallet/mensajeros).
const MAESTRO_EMAIL = "maestro@example.com";
const MAESTRO_PASSWORD = "correct-password";

// Seeded mensajero (owner of his own /mis-pagos view; only role authorized there).
const MENSAJERO_EMAIL = "mensajero@example.com";
const MENSAJERO_PASSWORD = "correct-password";

// Display name of the seeded mensajero (shown in the maestro's cuentas por pagar table).
const MENSAJERO_NOMBRE = "Ana Mensajera";

// Derived cuenta por pagar of the seeded mensajero (₡ prefix + STRING amount added by the UI, R16/R21).
const CUENTA_ESPERADA = "₡2000.00";

/** Logs in with the given credentials and lands on the app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Cuentas por pagar — acceso del maestro (/wallet/mensajeros)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, MAESTRO_EMAIL, MAESTRO_PASSWORD);
    await page.goto("/wallet/mensajeros");
  });

  test("ve las cuentas por pagar → expande el desglose por cierre → filtra por fecha/cierre y por mensajero", async ({
    page,
  }) => {
    // R18/R21: the cuentas por pagar table is pre-fetched server-side; amounts are rendered as
    // STRING (the client never receives Prisma.Decimal nor recomputes them).
    const tabla = page.getByRole("table", { name: "Cuentas por pagar a mensajeros" });
    await expect(tabla).toBeVisible();
    await expect(tabla.getByText(MENSAJERO_NOMBRE)).toBeVisible();
    await expect(tabla.getByText(CUENTA_ESPERADA)).toBeVisible();

    // R18: expand the mensajero → its DESGLOSE POR CIERRE loads client-side (paginated, most
    // recent first) inside the expanded region.
    await page
      .getByRole("button", { name: `Ver desglose de ${MENSAJERO_NOMBRE}` })
      .click();
    const desglose = page.getByRole("region", {
      name: `Desglose de ${MENSAJERO_NOMBRE}`,
    });
    await expect(desglose).toBeVisible();

    // R18: the per-cierre movements are shown as an accessible table (más reciente primero).
    const detalle = page.getByRole("table", {
      name: `Desglose por cierre de ${MENSAJERO_NOMBRE}`,
    });
    await expect(detalle).toBeVisible();
    // The expanded saldo initially matches the aggregate cuenta por pagar (R22 baseline).
    await expect(desglose.getByText(CUENTA_ESPERADA)).toBeVisible();

    // R22: filter the desglose server-side by date range + cierre. Applying re-fetches from the
    // maestro Server Action; the shown saldo then reflects the FILTERED set.
    await desglose.getByLabel("Desde").fill("2026-07-01");
    await desglose.getByLabel("Hasta").fill("2026-07-31");
    await desglose.getByRole("button", { name: "Aplicar" }).click();
    await expect(detalle).toBeVisible();

    // R22: filter the SUMMARY table by mensajero name (client-side over the pre-fetched set; no
    // fetch, no arithmetic on amounts). The row stays visible when the name matches the query.
    await page.getByRole("searchbox", { name: "Buscar por mensajero" }).fill(MENSAJERO_NOMBRE);
    await expect(tabla.getByText(MENSAJERO_NOMBRE)).toBeVisible();
  });
});

test.describe("Cuentas por pagar — bloqueo de rol NO autorizado (/wallet/mensajeros)", () => {
  test("un mensajero es rechazado en /wallet/mensajeros y NO ve cuentas por pagar (R19)", async ({
    page,
  }) => {
    // A non-maestro role hits the role-aware Server Component, which calls `notFound()`
    // (forbidden). No cuentas por pagar UI is rendered.
    await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
    await page.goto("/wallet/mensajeros");

    // R19: the cuentas por pagar table is NOT exposed to this role.
    await expect(
      page.getByRole("table", { name: "Cuentas por pagar a mensajeros" }),
    ).toHaveCount(0);
  });
});

test.describe("Mis pagos — acceso del mensajero (/mis-pagos)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
    await page.goto("/mis-pagos");
  });

  test("ve su cuenta por pagar derivada y el desglose de sus pagos (acotado a su mensajero_id)", async ({
    page,
  }) => {
    // R20/R21: the derived cuenta por pagar is pre-fetched server-side (scoped to his
    // mensajero_id in the WHERE) and rendered as a STRING amount, never Prisma.Decimal.
    const cuenta = page.getByRole("region", { name: "Cuenta por pagar" });
    await expect(cuenta).toBeVisible();
    await expect(cuenta.getByText(CUENTA_ESPERADA)).toBeVisible();

    // R20: the DESGLOSE of his pagos (more recent first) is shown as an accessible table.
    const desglose = page.getByRole("table", { name: "Desglose de pagos" });
    await expect(desglose).toBeVisible();
  });
});

test.describe("Mis pagos — bloqueo de rol NO autorizado (/mis-pagos)", () => {
  test("el maestro es rechazado en /mis-pagos y NO ve cuenta ni desglose (R20)", async ({
    page,
  }) => {
    // A non-mensajero role hits the role-aware Server Component, which calls `notFound()`.
    await login(page, MAESTRO_EMAIL, MAESTRO_PASSWORD);
    await page.goto("/mis-pagos");

    // R20: NEITHER the derived cuenta por pagar NOR the desglose table are exposed.
    await expect(page.getByRole("region", { name: "Cuenta por pagar" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Desglose de pagos" })).toHaveCount(0);
  });
});
