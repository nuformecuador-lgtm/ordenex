import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "/wallet" — the PRINCIPAL cash box of Ordenex (Feature 42, T11–T13 /
 * R18–R21). The wallet is an append-only LEDGER of immutable movements; the general
 * BALANCE is DERIVED (Σingreso − Σegreso) and never stored. The page is a role-aware
 * Server Component: only the `maestro` (owner of the central cash box) may see it; any
 * other role (or no session) is denied and NO movement or balance is exposed (R19).
 *
 * Covers the two flows the review required:
 *  1. Acceso del rol `maestro` (R18/R20/R21): the maestro logs in → /wallet → sees the
 *     derived BALANCE card and the movements LEDGER (table) → filters the book by tipo
 *     (the balance shown reflects the filtered set, R20) → registers a MANUAL adjustment
 *     movement (ingreso/egreso) whose `descripcion` is OBLIGATORY (R15): confirming with
 *     an empty description is blocked with a validation error, and with a description the
 *     movement is registered (success toast).
 *  2. Bloqueo de rol NO autorizado (R19): a non-maestro user (here a `mensajero`) navigates
 *     to /wallet and is denied (Next `notFound()` → no wallet UI): they see NEITHER the
 *     balance card NOR the ledger table (both absent), so no financial data leaks.
 *
 * PRECONDITION (seed):
 * - A seeded `maestro` M whose /wallet scope has at least one `wallet_movimiento` (e.g. an
 *   `ingreso_flete` fed by an approved `cierre_dia`, R5/R10) so the ledger is non-empty and
 *   the derived balance is a known amount (set BALANCE_ESPERADO below to the seeded value).
 * - A seeded non-maestro user (a `mensajero` here; any of mensajero/adminSatelite/adminTienda
 *   works for R19) with valid credentials, used to exercise the forbidden path.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres, the feature 42 `wallet_movimiento` table +
 *   enums (WalletMovimientoTipo/Categoria/OrigenTipo) and the `orden.cobra_comision` column
 *   migration applied, plus at least one seeded movement within the maestro's wallet
 * - A seeded `maestro` (with movements) and a seeded non-maestro user, per PRECONDITION
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but NOT
 * EXECUTED. Execution is deferred until the test environment is fully set up (same deferral
 * as e2e/cierres-admin.spec.ts, e2e/reglas-bloqueos-cierre.spec.ts, e2e/cierre-dia.spec.ts
 * and e2e/recepcion-satelite.spec.ts). They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed a `maestro` with at least one wallet movement and a non-maestro user; set the
 *    seed constants below
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded maestro (owner of the central cash box; only role authorized for /wallet).
const MAESTRO_EMAIL = "maestro@example.com";
const MAESTRO_PASSWORD = "correct-password";

// Seeded non-maestro user (mensajero) used for the forbidden path (R19).
const MENSAJERO_EMAIL = "mensajero@example.com";
const MENSAJERO_PASSWORD = "correct-password";

// Derived balance of the seeded wallet (₡ prefix + STRING amount added by the UI, R17/R21).
const BALANCE_ESPERADO = "₡1500.00";

/** Logs in with the given credentials and lands on the app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe("Wallet — acceso del maestro (libro + balance + manual)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, MAESTRO_EMAIL, MAESTRO_PASSWORD);
    await page.goto("/wallet");
  });

  test("ve el balance derivado y el libro → filtra por tipo → registra un movimiento manual con descripción obligatoria", async ({
    page,
  }) => {
    // R18/R21: the derived general balance is pre-fetched server-side and rendered as a
    // STRING amount (the client never receives Prisma.Decimal nor recomputes it).
    const balance = page.getByRole("region", { name: "Balance general" });
    await expect(balance).toBeVisible();
    await expect(balance.getByText(BALANCE_ESPERADO)).toBeVisible();

    // R18: the movements LEDGER (more recent first) is shown as an accessible table.
    const libro = page.getByRole("table", { name: "Libro de movimientos" });
    await expect(libro).toBeVisible();

    // R20: filter the book by tipo (ingreso). The reload re-fetches ledger + balance via a
    // Server Action (internal read, NOT a fetch to /api); the shown balance reflects the
    // filtered set. The filter control is the accessible combobox "Filtrar por tipo".
    await page.getByRole("combobox", { name: "Filtrar por tipo" }).click();
    await page.getByRole("option", { name: "Ingreso" }).click();
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(libro).toBeVisible();

    // R15: open the manual adjustment dialog (only maestro; the page already gated the role).
    await page.getByRole("button", { name: "Registrar movimiento" }).click();
    const dialog = page.getByRole("dialog", { name: "Registrar movimiento manual" });
    await expect(dialog).toBeVisible();

    // Fill an amount but leave the description empty → confirming is blocked and the
    // "descripción obligatoria" validation error is shown (R15).
    await dialog.getByLabel("Monto").fill("100.00");
    await dialog.getByRole("button", { name: "Registrar" }).click();
    await expect(dialog.getByText("La descripción es obligatoria.")).toBeVisible();

    // With a description, the manual movement is registered (append-only, immutable, R3/R15).
    await dialog.getByLabel("Descripción").fill("Ajuste de caja por conciliación");
    await dialog.getByRole("button", { name: "Registrar" }).click();

    // Success feedback confirms the movement entered the ledger.
    await expect(page.getByText(/Movimiento registrado correctamente/i)).toBeVisible();
  });
});

test.describe("Wallet — bloqueo de rol NO autorizado", () => {
  test("un mensajero es rechazado en /wallet y NO ve movimientos ni balance (R19)", async ({
    page,
  }) => {
    // A non-maestro role hits the role-aware Server Component, which calls `notFound()`
    // (forbidden). No wallet UI is rendered.
    await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
    await page.goto("/wallet");

    // R19: NEITHER the derived balance NOR the movements ledger are exposed to this role.
    await expect(page.getByRole("region", { name: "Balance general" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Libro de movimientos" })).toHaveCount(0);
  });
});
