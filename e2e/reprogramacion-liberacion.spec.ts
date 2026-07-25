import { test, expect, type Page } from "@playwright/test";

/**
 * E2E tests for "Reprogramación: bloqueo y liberación programada" — the critical
 * operational path of Feature 46 (T16 / R1, R7, R12, R15). It chains the courier's
 * management flow, the temporal trigger (`/api/cron/liberar-reprogramadas`) and the
 * warehouse's derived notice "Liberadas hoy (reprogramación)".
 *
 * Covers the full critical path (all steps chained, DB-mutating, hence serial):
 *  1. Reprogramar con fecha futura (seed precondition): an order managed as
 *     `reprogramada` with `fecha_reprogramacion > hoy` (CR) is left in status
 *     `reprogramada`, keeping its `zonaId` (central for the maestro path).
 *  2. Bloqueo (R1/R2): while `fecha_reprogramacion > hoy`, the order is NOT
 *     assignable. In the maestro's "Órdenes" view it is NOT listed under any
 *     assignable apartado (`en_bodega_central`/`en_fulfillment`), so it cannot be selected
 *     nor sent — the block is server-side (guardas de `generarGuia`/`asignarDesdeBodega`).
 *  3. Corte de fecha + cron (R7/R12): invoking `GET /api/cron/liberar-reprogramadas`
 *     with the correct `Authorization: Bearer <CRON_SECRET>` returns `200` with the
 *     aggregate summary and transitions the (now due) order to `en_bodega_central` (central)
 *     / `en_bodega_satelite` (satellite), clearing its courier.
 *  4. Aviso derivado (R15): after refreshing the warehouse view, the order appears in
 *     the "Liberadas hoy (reprogramación)" region of the responsible warehouse
 *     (maestro central here), keyed by its guía/remisión and destinatario.
 *
 * The `hoy` seam (R9): the cron compares `fecha_reprogramacion` against "hoy" (CR).
 * To simulate the "date cut" WITHOUT a fake clock, the seed sets the order's
 * `fecha_reprogramacion` to a date that is already `<= hoy` at cron time (e.g.
 * yesterday CR), so step 2 seeds a still-future date and step 3 uses an order whose
 * date has already arrived. See PRECONDITION.
 *
 * PRECONDITION (seed):
 * - A `maestro` user (bodega central responsible).
 * - Order A: status `reprogramada`, `zonaId` = the central zone, its latest
 *   `gestion_orden reprogramada` with `fecha_reprogramacion > hoy` (CR) — the BLOCKED
 *   one asserted in step 2 (must NOT appear as assignable). Set A_REMISION.
 * - Order B: status `reprogramada`, `zonaId` = the central zone, its latest
 *   `gestion_orden reprogramada` with `fecha_reprogramacion <= hoy` (CR) — the DUE one
 *   the cron liberates in step 3, asserted in the "Liberadas hoy" region in step 4.
 *   Set B_REMISION and B_DESTINATARIO.
 * - `CRON_SECRET` set in the server env (same secret as the daily cut-off, R8).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev) with `CRON_SECRET` in its env.
 * - A test database with Supabase/Postgres, the feature 46 migration
 *   (`orden.liberada_reprogramada_at` + partial index) applied, and the
 *   order/gestion catalog values seeded (incl. `reprogramada`, `en_bodega_central`).
 * - The seeded maestro and orders A/B per PRECONDITION above.
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/reglas-bloqueos-cierre.spec.ts, e2e/cierre-dia.spec.ts and
 * e2e/asignacion-satelite.spec.ts). They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials (incl. CRON_SECRET).
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed a maestro, order A (fecha futura) and order B (fecha <= hoy) in the central
 *    zone per PRECONDITION; set the constants below and CRON_SECRET.
 * 4. Run tests: pnpm run test:e2e
 */

// Seeded maestro credentials (would come from test config / a user factory).
const MAESTRO_EMAIL = "maestro@example.com";
const MAESTRO_PASSWORD = "correct-password";

// Order A: reprogramada with fecha FUTURA (stays blocked, step 2).
const A_REMISION = "REM-SEED-REPROG-FUTURA";
// Order B: reprogramada with fecha <= hoy (the cron liberates it, steps 3–4).
const B_REMISION = "REM-SEED-REPROG-VENCIDA";
const B_DESTINATARIO = "Destinatario Seed Liberado";

// Same secret configured in the server env (R8, shared with the daily cut-off).
const CRON_SECRET = process.env.CRON_SECRET ?? "test-cron-secret";

/** Logs in as the seeded maestro and lands on the app. */
async function loginMaestro(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', MAESTRO_EMAIL);
  await page.fill('input[type="password"]', MAESTRO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

test.describe.serial("Reprogramación — bloqueo y liberación programada", () => {
  test("orden reprogramada con fecha futura queda bloqueada (no asignable)", async ({
    page,
  }) => {
    await loginMaestro(page);
    await page.goto("/ordenes");

    // R1/R2: while `fecha_reprogramacion > hoy`, order A is NOT in any assignable
    // apartado (it stays in `reprogramada`, which no apartado of the maestro lists),
    // so it can neither be selected nor sent.
    const enBodega = page.getByRole("region", { name: /En bodega/i }).first();
    await expect(enBodega).toBeVisible();
    await expect(
      enBodega.getByRole("checkbox", { name: `Seleccionar ${A_REMISION}` }),
    ).toHaveCount(0);
  });

  test("cron libera la orden vencida → 200 y aparece en 'Liberadas hoy'", async ({
    page,
    request,
  }) => {
    // R7/R12: simulate the date cut by invoking the liberation cron with the correct
    // secret. It returns 200 with the aggregate summary (no PII) and transitions the
    // due order B to `en_bodega_central` (central), clearing its courier.
    const res = await request.get("/api/cron/liberar-reprogramadas", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      evaluadas: number;
      liberadas: number;
      omitidas: number;
    };
    expect(body.liberadas).toBeGreaterThanOrEqual(1);

    // R15: after the cron, the maestro's warehouse view shows order B in the derived
    // "Liberadas hoy (reprogramación)" region (keyed by remisión + destinatario).
    await loginMaestro(page);
    await page.goto("/ordenes");
    const liberadas = page.getByRole("region", {
      name: "Liberadas hoy (reprogramación)",
    });
    await expect(liberadas).toBeVisible();
    await expect(liberadas.getByText(new RegExp(B_REMISION))).toBeVisible();
    await expect(liberadas.getByText(new RegExp(B_DESTINATARIO))).toBeVisible();
  });

  test("cron sin secreto correcto → 401 sin efectos", async ({ request }) => {
    // R6 (defensa del borde, verificado también en el test de ruta): sin/incorrecto
    // secret → 401 y no libera nada.
    const res = await request.get("/api/cron/liberar-reprogramadas", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status()).toBe(401);
  });
});
