import { test, expect, type Page } from "@playwright/test";

/**
 * E2E — Historial de estados de una orden: línea de tiempo de trazabilidad
 * (Feature 49, T7.4 — flujo crítico R29).
 *
 * Cubre el camino de VISUALIZACIÓN del historial desde la lista de órdenes:
 *  - R26: al solicitar el historial de una orden, sus transiciones se muestran
 *    ordenadas cronológicamente, cada una con estado origen (o "Creación"),
 *    destino, instante, actor (o "Sistema") y motivo si lo hay.
 *  - R29: la línea de tiempo del drawer presenta, por transición, el estado
 *    destino, el timestamp, el actor (o "Sistema") y el motivo cuando existe.
 *  - R30: los estados se muestran con su ETIQUETA legible (vía estatus-label),
 *    NUNCA el UUID/value crudo.
 *  - R27 (lado DENY, verificación barata en UI): un actor SIN visibilidad sobre
 *    la orden no encuentra el disparador "Ver historial" de esa orden en su
 *    lista (no puede ni abrir el drawer). La matriz completa de autorización
 *    (maestro/adminTienda/mensajero/adminSatélite → forbidden/not_found) vive en
 *    los tests unit de la Server Action `obtenerHistorialOrden` (R27).
 *
 * SUPERFICIE (verificada en el código, feature 49 T6.2):
 *  - El listado PLANO de `/ordenes` (`OrdenesModule` con `mostrarHistorial`) se
 *    muestra a los roles NO maestro/admin (adminTienda, mensajero, adminSatélite);
 *    maestro/admin ven la vista de revisión por apartados (`OrdenesRevisionMaestro`),
 *    SIN este botón. Por eso el usuario semilla es un `adminTienda` (ve TODAS las
 *    órdenes de su tienda en cualquier estado, R27) y NO un maestro.
 *  - Cada fila añade un botón `aria-label="Ver historial de la orden <remisión>"`
 *    (HistorialOrdenSheet) que abre un Sheet (role="dialog") titulado
 *    "Historial de la orden <remisión>", cuyo cuerpo es una
 *    `<ol aria-label="Línea de tiempo de estados">` (role="list") con un `<li>`
 *    (role="listitem") por transición: "Creación · <destino>" o
 *    "<origen> → <destino>", el `<time>`, "Por <actor|Sistema>" y
 *    "Motivo: <motivo>" cuando existe (HistorialOrdenTimeline).
 *
 * PRECONDITION (seed):
 * - Un `adminTienda` AUTORIZADO (dueño de la tienda de la orden semilla):
 *   ADMIN_TIENDA_EMAIL / ADMIN_TIENDA_PASSWORD.
 * - Una orden de esa tienda con numRemisión = REMISION que YA recorrió ≥2
 *   transiciones, de modo que su `orden_historial_estado` tenga ≥2 filas, en este
 *   orden cronológico (la creación primero, la liberación del cron al final):
 *     1. CREACIÓN (carga masiva, R9): origen vacío → `en_preparacion`
 *        ("En preparación"), actor HUMANO (el adminTienda que la subió).
 *     2. GESTIÓN del mensajero (feature 36, R17/R22): `en_ruta` →
 *        `reprogramada` ("Reprogramada"), actor HUMANO = ACTOR_HUMANO, con MOTIVO.
 *     3. LIBERACIÓN del cron (feature 46, R18/R21): `reprogramada` → `en_bodega_central`
 *        ("En bodega"), actor VACÍO → se muestra "Sistema", sin motivo; es la más
 *        reciente y la orden QUEDA en `en_bodega_central` (no hay transiciones posteriores).
 *   (Puede haber transiciones intermedias — generar guía, recoger — que añadan más
 *   `<li>`; las aserciones apuntan a entradas concretas, no a todas. "Sistema" y el
 *   MOTIVO son únicos en este seed, lo que hace robustas las aserciones de orden.)
 * - Un `adminTienda` de OTRA tienda SIN visibilidad de la orden:
 *   OTRO_ADMIN_EMAIL / OTRO_ADMIN_PASSWORD (para el lado deny de R27).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev).
 * - A test database with Supabase/Postgres and the feature 49 migration
 *   (`orden_historial_estado` + índice `(orden_id, created_at)` + RLS) applied,
 *   plus the order-status catalog seeded (incl. `en_preparacion`, `reprogramada`,
 *   `en_bodega_central`).
 * - The two seeded adminTienda users and the order per PRECONDITION above.
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/reprogramacion-liberacion.spec.ts and
 * e2e/mis-asignaciones.spec.ts). They do NOT run under `pnpm test` (vitest only
 * includes `tests/**`, and this spec imports from `@playwright/test`).
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials.
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed the two adminTienda users and the order with ≥2 historial rows per
 *    PRECONDITION; set the constants below.
 * 4. Run tests: pnpm run test:e2e
 */

// Authorized adminTienda (owns the seed order's tienda; sees it in any state, R27).
const ADMIN_TIENDA_EMAIL = "admin.tienda@example.com";
const ADMIN_TIENDA_PASSWORD = "correct-password";

// A different-tienda adminTienda WITHOUT visibility of the seed order (R27 deny).
const OTRO_ADMIN_EMAIL = "otro.admin.tienda@example.com";
const OTRO_ADMIN_PASSWORD = "correct-password";

// Seed order: numRemisión (the row's readable key used in the button/title).
const REMISION = "REM-SEED-HISTORIAL";

// Expected readable state labels (via estatus-label), in chronological order.
const LABEL_CREACION_DESTINO = "En preparación"; // 1ª entrada (creación)
const LABEL_REPROGRAMADA = "Reprogramada"; // gestión del mensajero (con motivo)
const LABEL_FINAL = "En bodega"; // última entrada (liberación del cron)

// Actors and motivo shown in the timeline.
const ACTOR_SISTEMA = "Sistema"; // cron/job (actor vacío) → se muestra "Sistema"
const ACTOR_HUMANO = "María López"; // mensajero que gestionó (actor humano)
const MOTIVO = "Cliente ausente"; // motivo de la gestión (reprogramada)

// Accessible names derivados de HistorialOrdenSheet.tsx (selectores reales).
const TRIGGER_NAME = `Ver historial de la orden ${REMISION}`;
const DIALOG_TITLE = `Historial de la orden ${REMISION}`;

// Ningún UUID/value crudo debe aparecer en la línea de tiempo (R30).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Inicia sesión con el usuario dado y aterriza en la app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

/** Abre el drawer "Ver historial" de la orden semilla y devuelve su dialog. */
async function abrirHistorial(page: Page) {
  await page.getByRole("button", { name: TRIGGER_NAME }).click();
  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe.serial("Historial de estados — línea de tiempo (R26/R27/R29/R30)", () => {
  test("adminTienda autorizado abre el drawer 'Ver historial' de la orden", async ({
    page,
  }) => {
    await login(page, ADMIN_TIENDA_EMAIL, ADMIN_TIENDA_PASSWORD);
    await page.goto("/ordenes");

    // R29: el detalle (drawer) de la orden abre con su título legible visible.
    const dialog = await abrirHistorial(page);
    await expect(
      dialog.getByRole("heading", { name: DIALOG_TITLE }),
    ).toBeVisible();
  });

  test("la línea de tiempo muestra etiquetas legibles EN ORDEN, actor y motivo", async ({
    page,
  }) => {
    await login(page, ADMIN_TIENDA_EMAIL, ADMIN_TIENDA_PASSWORD);
    await page.goto("/ordenes");

    const dialog = await abrirHistorial(page);

    // El cuerpo del drawer es la <ol aria-label="Línea de tiempo de estados">.
    const timeline = dialog.getByRole("list", {
      name: "Línea de tiempo de estados",
    });
    await expect(timeline).toBeVisible();

    const entradas = timeline.getByRole("listitem");
    await expect(entradas.first()).toBeVisible();

    // R30: se ven etiquetas legibles de estado (dos, en extremos opuestos)…
    await expect(dialog.getByText(LABEL_CREACION_DESTINO)).toBeVisible();
    await expect(dialog.getByText(LABEL_FINAL)).toBeVisible();
    // …y NINGÚN UUID crudo en toda la línea de tiempo.
    await expect(dialog.getByText(UUID_RE)).toHaveCount(0);

    // R26/R29 — ORDEN cronológico ascendente: la CREACIÓN es la 1ª entrada…
    const primera = entradas.first();
    await expect(primera.getByText("Creación")).toBeVisible();
    await expect(primera.getByText(LABEL_CREACION_DESTINO)).toBeVisible();

    // …y la LIBERACIÓN del cron (actor "Sistema") es la ÚLTIMA (la más reciente),
    // demostrando que la primera (creación) precede a la última (Sistema/en_bodega_central).
    const ultima = entradas.last();
    await expect(ultima.getByText(LABEL_FINAL)).toBeVisible();
    await expect(ultima.getByText(`Por ${ACTOR_SISTEMA}`)).toBeVisible();

    // R29 — la gestión (reprogramada) presenta actor HUMANO + MOTIVO.
    const gestion = entradas.filter({ hasText: `Motivo: ${MOTIVO}` }).first();
    await expect(gestion).toBeVisible();
    await expect(gestion.getByText(LABEL_REPROGRAMADA)).toBeVisible();
    await expect(gestion.getByText(`Por ${ACTOR_HUMANO}`)).toBeVisible();
  });

  test("un adminTienda de otra tienda NO ve el disparador de historial (R27 deny)", async ({
    page,
  }) => {
    await login(page, OTRO_ADMIN_EMAIL, OTRO_ADMIN_PASSWORD);
    await page.goto("/ordenes");

    // Sin visibilidad sobre la orden, ésta no aparece en su lista → no existe el
    // botón "Ver historial" para esa remisión (no puede ni abrir el drawer). El
    // lado forbidden/not_found de la Server Action está cubierto por los unit (R27).
    await expect(
      page.getByRole("button", { name: TRIGGER_NAME }),
    ).toHaveCount(0);
  });
});
