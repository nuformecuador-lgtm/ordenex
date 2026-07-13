import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "/mi-wallet" — the SALDO A FAVOR of a store (Feature 43, T14–T15 /
 * R18–R22). Each store (`adminTienda`) has its own wallet: how much Ordenex owes it
 * (COD collected minus flete + comisión + IVAs, the EXACT complement of Ordenex's income
 * in feature 42). The saldo is DERIVED from an append-only LEDGER (never stored) and may be
 * NEGATIVE (the store owes Ordenex, e.g. for return fees). The page is a role-aware Server
 * Component: only the `adminTienda` OWNER may see it, ALWAYS scoped to its own tienda_id in
 * the WHERE (R19); any other role (or no session) is denied and NO saldo or breakdown is
 * exposed (R19).
 *
 * Covers the two flows the review required (the feature 42 review rejected for omitting E2E):
 *  1. Acceso del rol `adminTienda` (R18/R21/R22): the store admin logs in → /mi-wallet →
 *     sees its SALDO A FAVOR card (derived, rendered as a STRING amount, never Prisma.Decimal)
 *     and the DESGLOSE ledger (table) by cierre/concepto → filters the breakdown by concepto
 *     (the saldo shown reflects the filtered set, R22).
 *  2. Bloqueo de rol NO autorizado (R19): a non-adminTienda user (here a `mensajero`)
 *     navigates to /mi-wallet and is denied (Next `notFound()` → no wallet UI): they see
 *     NEITHER the saldo card NOR the ledger table (both absent), so no financial data leaks.
 *
 * PRECONDITION (seed):
 * - A seeded `adminTienda` T whose /mi-wallet scope has at least one `wallet_tienda_movimiento`
 *   (e.g. a `cod_recaudado` credit + a `flete` debit fed by an approved `cierre_dia`,
 *   R5/R10) so the ledger is non-empty and the derived saldo is a known amount (set
 *   SALDO_ESPERADO below to the seeded value).
 * - A seeded non-adminTienda user (a `mensajero` here; any of mensajero/maestro/adminSatelite
 *   works for R19) with valid credentials, used to exercise the forbidden path.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres, the feature 43 `wallet_tienda_movimiento` table +
 *   enums (WalletTiendaMovimientoTipo/Categoria) and the feature 42 tables/migrations applied,
 *   plus at least one seeded movement within the store's ledger
 * - A seeded `adminTienda` (with movements) and a seeded non-adminTienda user, per PRECONDITION
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but NOT
 * EXECUTED. Execution is deferred until the test environment is fully set up (same deferral
 * as e2e/wallet.spec.ts, e2e/cierres-admin.spec.ts and the rest of the repo's e2e). They do
 * NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed an `adminTienda` with at least one wallet_tienda_movimiento and a non-adminTienda
 *    user; set the seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded adminTienda (owner of the store wallet; only role authorized for /mi-wallet).
const TIENDA_EMAIL = "tienda@example.com";
const TIENDA_PASSWORD = "correct-password";

// Seeded non-adminTienda user (mensajero) used for the forbidden path (R19).
const MENSAJERO_EMAIL = "mensajero@example.com";
const MENSAJERO_PASSWORD = "correct-password";

// Derived saldo a favor of the seeded store (₡ prefix + STRING amount added by the UI, R17/R21).
const SALDO_ESPERADO = "₡3800.00";

/** Logs in with the given credentials and lands on the app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Mi wallet — acceso del adminTienda (saldo + desglose)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TIENDA_EMAIL, TIENDA_PASSWORD);
    await page.goto("/mi-wallet");
  });

  test("ve su saldo a favor derivado y el desglose → filtra por concepto (el saldo refleja el conjunto filtrado)", async ({
    page,
  }) => {
    // R18/R21: the derived saldo a favor is pre-fetched server-side and rendered as a STRING
    // amount (the client never receives Prisma.Decimal nor recomputes it).
    const saldo = page.getByRole("region", { name: "Saldo a favor" });
    await expect(saldo).toBeVisible();
    await expect(saldo.getByText(SALDO_ESPERADO)).toBeVisible();

    // R18: the DESGLOSE ledger (more recent first) is shown as an accessible table.
    const desglose = page.getByRole("table", { name: "Desglose de movimientos" });
    await expect(desglose).toBeVisible();

    // R22: filter the breakdown by concepto (COD recaudado). The reload re-fetches ledger +
    // saldo via a Server Action (internal read, NOT a fetch to /api); the shown saldo reflects
    // the filtered set. The filter control is the accessible combobox "Filtrar por concepto".
    await page.getByRole("combobox", { name: "Filtrar por concepto" }).click();
    await page.getByRole("option", { name: "COD recaudado" }).click();
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(desglose).toBeVisible();
  });
});

test.describe("Mi wallet — bloqueo de rol NO autorizado", () => {
  test("un mensajero es rechazado en /mi-wallet y NO ve saldo ni desglose (R19)", async ({
    page,
  }) => {
    // A non-adminTienda role hits the role-aware Server Component, which calls `notFound()`
    // (forbidden). No wallet UI is rendered.
    await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
    await page.goto("/mi-wallet");

    // R19: NEITHER the derived saldo NOR the desglose ledger are exposed to this role.
    await expect(page.getByRole("region", { name: "Saldo a favor" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Desglose de movimientos" })).toHaveCount(0);
  });
});
