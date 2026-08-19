import { test, expect, type Page } from "@playwright/test";

/**
 * E2E — Reintentos de entrega y escalado automático a rechazo
 * (Feature 47, T5.2 — flujo crítico R8/R9/R15).
 *
 * Cubre el camino de ESCALADO desde tres devoluciones consecutivas y la lectura
 * del conteo de intentos en la línea de tiempo de la orden:
 *  - R8: la N-ésima devolución (N = umbral, aquí 3) escala la orden a `rechazada`
 *    (estado FINAL) de forma síncrona, en la misma operación de la gestión, en vez
 *    de devolverla a la bodega.
 *  - R9: las devoluciones 1ª y 2ª (por debajo del umbral) devuelven la orden a su
 *    bodega responsable para reintentar (queda `en_bodega_central`, "En bodega"); SÓLO la
 *    3ª escala a `rechazada` ("Rechazada").
 *  - R15: al abrir "Ver historial", el drawer muestra cuántos intentos lleva la
 *    orden como badge "Intento 3 de 3" (conteo DERIVADO del historial, no
 *    materializado), y la línea de tiempo presenta las 3 devoluciones + el
 *    escalado con etiquetas legibles (R16, vía estatus-label; NUNCA UUIDs).
 *
 * SUPERFICIE (verificada en el código, features 36/47/49):
 *  - GESTIÓN (mensajero): `/mis-asignaciones` → "Por recoger" → botón "Recoger"
 *    (por_recoger → en_reparto) → "En reparto / por gestionar" →
 *    "Gestionar" (candado 1-a-1) → modal role="dialog" name="Gestionar orden" →
 *    Select "Resultado de la gestión" opción "Devolución" (value `devuelta`) →
 *    campo "Motivo" → "Guardar gestión". Tras una devolución BAJO umbral la orden
 *    vuelve a `en_bodega_central` con el mensajero liberado (handoff a bodega, R6).
 *  - RE-ASIGNACIÓN (maestro/admin de bodega): `/ordenes` (revisión por apartados)
 *    → region "En bodega" → seleccionar la orden → "Asignar mensajero" → modal
 *    role="dialog" name="Asignar mensajero" → elegir mensajero → confirmar. Vuelve
 *    a `por_recoger` para el siguiente intento.
 *  - VISUALIZACIÓN del historial (adminTienda dueño de la tienda, ve la orden en
 *    cualquier estado, feature 49/R27): `/ordenes` (listado plano) → cada fila con
 *    `aria-label="Ver historial de la orden <remisión>"` (HistorialOrdenSheet) →
 *    Sheet role="dialog" name="Historial de la orden <remisión>" cuyo cuerpo tiene:
 *      · Feature 47: un badge role="status" aria-label="Intentos de entrega: 3 de 3"
 *        con el texto legible "Intento 3 de 3" (SÓLO si la orden lleva ≥1 devolución,
 *        R16).
 *      · Feature 49: una `<ol aria-label="Línea de tiempo de estados">` (role="list")
 *        con un `<li>` (role="listitem") por transición ("Creación · <destino>" o
 *        "<origen> → <destino>"), timestamp, "Por <actor|Sistema>" y "Motivo: <…>".
 *  - El escalado (`devuelta → rechazada`) lo dispara el SISTEMA (actor NULL → se
 *    muestra "Sistema"); su fila destino es "Rechazada" (feature 47/R8/R10).
 *
 * PRECONDITION (seed):
 * - Umbral de intentos = 3 (default por ley; `REINTENTOS_MIN_INTENTOS` sin definir
 *   o = 3). Con umbral 3, la 3ª devolución es la que escala (R9).
 * - Un `mensajero` AUTORIZADO con la orden semilla asignada en `por_recoger`:
 *   MENSAJERO_EMAIL / MENSAJERO_PASSWORD. (Puede re-asignarse a él mismo entre
 *   intentos; lo relevante es que gestione la orden cada vez.)
 * - Un `maestro`/admin de bodega para RE-ASIGNAR la orden entre devoluciones:
 *   MAESTRO_EMAIL / MAESTRO_PASSWORD.
 * - Un `adminTienda` dueño de la tienda de la orden (ve la orden en cualquier
 *   estado en el listado plano de `/ordenes`, feature 49/R27):
 *   ADMIN_TIENDA_EMAIL / ADMIN_TIENDA_PASSWORD.
 * - Una orden de esa tienda con numRemisión = REMISION, zona CENTRAL (para que el
 *   reintento la devuelva a `en_bodega_central` — no satélite), guía ya generada y sin
 *   devoluciones previas (contador de intentos = 0 al empezar).
 * - El bucket privado de Supabase Storage `gestion-evidencias` creado (aunque la
 *   rama `devuelta` no sube evidencia, el modal comparte infraestructura).
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev).
 * - A test database with Supabase/Postgres and the feature 49 migration
 *   (`orden_historial_estado` + índices + RLS) applied, plus the order-status
 *   catalog seeded (incl. `por_recoger`, `en_reparto`, `devuelta`,
 *   `en_bodega_central`, `rechazada`).
 * - The seeded mensajero, maestro and adminTienda users, and the order in
 *   `por_recoger` per PRECONDITION above, with the retry threshold = 3.
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but
 * NOT EXECUTED. Execution is deferred until the test environment is fully set up
 * (same deferral as e2e/historial-orden.spec.ts, e2e/mis-asignaciones.spec.ts and
 * e2e/reprogramacion-liberacion.spec.ts). They do NOT run under `pnpm test`
 * (vitest only includes `tests/**`, and this spec imports from `@playwright/test`).
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials.
 * 2. Run migrations: pnpm run db:migrate
 * 3. Ensure the retry threshold is 3 (leave REINTENTOS_MIN_INTENTOS unset or = 3).
 * 4. Create the `gestion-evidencias` private bucket.
 * 5. Seed the mensajero, maestro and adminTienda users and the order in
 *    `por_recoger` per PRECONDITION; set the constants below.
 * 6. Run tests: pnpm run test:e2e
 */

// Mensajero that manages (gestiona) the order on each attempt.
const MENSAJERO_EMAIL = "mensajero@example.com";
const MENSAJERO_PASSWORD = "correct-password";

// Maestro/bodega admin that re-assigns the order between returns.
const MAESTRO_EMAIL = "maestro@example.com";
const MAESTRO_PASSWORD = "correct-password";

// AdminTienda that OWNS the order's tienda (sees it in any state, feature 49/R27).
const ADMIN_TIENDA_EMAIL = "admin.tienda@example.com";
const ADMIN_TIENDA_PASSWORD = "correct-password";

// Seed order: numRemisión (the row's readable key used in the button/title).
const REMISION = "REM-SEED-REINTENTOS";

// Retry threshold under test (default por ley). The 3rd return escalates (R9).
const UMBRAL = 3;

// ---------------------------------------------------------------------------------------------
// 2026-08-19 — FEATURE 239 (T4.2). La gestión del mensajero YA NO deja la orden en `devuelta`:
// la deja en `devolucion_por_confirmar` («Devolución por confirmar»), y a `devuelta` se llega
// SOLO cuando un admin APRUEBA el cierre del día. Esa aprobación es a la vez lo que hace visible
// la devolución para la tienda y lo que arranca su ventana de SLA.
//
// PARA ESTE FLUJO SIGNIFICA UN PASO MÁS entre cada devolución y su seguimiento: gestionar →
// APROBAR EL CIERRE → (recién entonces) el cron evalúa la ventana y libera o escala. El escalado
// del umbral ya lo movía la feature 99 del momento de la gestión al cron; la 239 le añade la
// aprobación como precondición.
//
// ESTADO DE EJECUCIÓN, sin adornos: esta spec —como el resto de `e2e/`— está ESCRITA y NO
// EJECUTADA (ver EXECUTION NOTE arriba): no hay harness ni base sembrada, y `pnpm test` no la
// incluye. Así que NO se puede afirmar que «falla si se salta la aprobación»: no corre. Lo que sí
// se hace es dejarla de acuerdo con el comportamiento real, para que no describa un flujo que ya
// no existe — una spec que miente es peor que una que no corre.
//
// LA COBERTURA EJECUTABLE de esta propiedad vive en tests que SÍ corren, y son estos:
//   · `tests/unit/services/mis-asignaciones-service.test.ts` — gestionar `devuelta` deja la orden
//     en el PRE-ESTADO, no en `devuelta`.
//   · `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` — aprobar el cierre es lo
//     que la lleva a `devuelta`, en la misma transacción.
//   · `tests/unit/repositories/devolucion-sla-repository.test.ts` — una orden en el pre-estado NO
//     es candidata del cron (R13), y el reloj se ancla en la aprobación (R12).
// ---------------------------------------------------------------------------------------------

// Readable state labels (via estatus-label) shown in the timeline (R16).
// 2026-08-19 (feature 239): la transición que produce la GESTIÓN del mensajero ya no es
// `devuelta` sino el pre-estado; `devuelta` la produce la APROBACIÓN del cierre. Son dos filas
// distintas de la línea de tiempo, con dos etiquetas distintas.
const LABEL_PRE_CONFIRMACION = "Devolución por confirmar"; // lo que deja la gestión del mensajero
const LABEL_DEVUELTA = "Devuelta"; // lo que deja la APROBACIÓN del cierre (el anclaje)
const LABEL_BODEGA = "En bodega"; // seguimiento de reintento (1ª y 2ª devolución)
const LABEL_RECHAZADA = "Rechazada"; // escalado final (3ª devolución)

// System actor label for the automatic follow-up transition (actor NULL, R10/R29).
const ACTOR_SISTEMA = "Sistema";

// Motivo registered on each management (differentiates devoluciones if needed).
const MOTIVO = "Cliente ausente";

// Accessible names derivados de HistorialOrdenSheet.tsx (selectores reales).
const TRIGGER_NAME = `Ver historial de la orden ${REMISION}`;
const DIALOG_TITLE = `Historial de la orden ${REMISION}`;
const BADGE_TEXT = `Intento ${UMBRAL} de ${UMBRAL}`; // "Intento 3 de 3" (R15)

// Ningún UUID/value crudo debe aparecer en la línea de tiempo (R16/R30).
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Inicia sesión con el usuario dado y aterriza en la app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

/** Cierra sesión para intercalar actores (mensajero ↔ maestro ↔ adminTienda). */
async function logout(page: Page) {
  await page.getByRole("button", { name: /Cerrar sesión/i }).click();
  await page.waitForURL(/\/login/, { timeout: 5000 });
}

/** Elige una opción en un Select (base-ui) por su nombre accesible. */
async function elegirEnSelect(
  page: Page,
  comboboxName: string,
  optionName: string,
) {
  await page.getByRole("combobox", { name: comboboxName }).click();
  await page.getByRole("option", { name: optionName }).click();
}

/**
 * El mensajero registra UNA devolución de la orden semilla:
 * Recoger (por_recoger → en_reparto) → Gestionar → resultado "Devolución"
 * (value `devuelta`) + Motivo → Guardar gestión.
 */
async function mensajeroDevuelveOrden(page: Page) {
  await login(page, MENSAJERO_EMAIL, MENSAJERO_PASSWORD);
  await page.goto("/mis-asignaciones");

  // Recoger la orden (pasa a en_reparto).
  const porRecoger = page.getByRole("region", { name: "Por recoger" });
  await expect(porRecoger).toBeVisible();
  await porRecoger.getByRole("button", { name: "Recoger" }).first().click();
  const confirmDialog = page.getByRole("dialog", { name: "Recoger órdenes" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Recoger" }).click();

  // Gestionar → Devolución.
  const porGestionar = page.getByRole("region", {
    name: "En reparto / por gestionar",
  });
  await expect(porGestionar).toBeVisible();
  await porGestionar.getByRole("button", { name: "Gestionar" }).first().click();

  const modal = page.getByRole("dialog", { name: "Gestionar orden" });
  await expect(modal).toBeVisible();
  await elegirEnSelect(page, "Resultado de la gestión", "Devolución");
  await modal.getByLabel("Motivo").fill(MOTIVO);
  await modal.getByRole("button", { name: "Guardar gestión" }).click();

  // La devolución cierra el modal (bajo umbral: vuelve a bodega; en umbral: escala).
  await expect(modal).toBeHidden();
  await logout(page);
}

/**
 * El maestro re-asigna la orden desde "En bodega" a un mensajero, dejándola lista
 * para el siguiente intento (por_recoger). Sólo aplica cuando la orden
 * volvió a la bodega (devolución bajo umbral).
 */
async function maestroReasignaDesdeBodega(page: Page) {
  await login(page, MAESTRO_EMAIL, MAESTRO_PASSWORD);
  await page.goto("/ordenes");

  const bodega = page.getByRole("region", { name: "En bodega" });
  await expect(bodega).toBeVisible();
  // Seleccionar la orden semilla por su remisión y abrir el modal de asignación.
  const fila = bodega.getByRole("row", { name: new RegExp(REMISION) });
  await fila.getByRole("checkbox").check();
  await bodega.getByRole("button", { name: "Asignar mensajero" }).click();

  const modal = page.getByRole("dialog", { name: "Asignar mensajero" });
  await expect(modal).toBeVisible();
  await elegirEnSelect(page, "Mensajero", "Juan Mensajero");
  await modal.getByRole("button", { name: "Asignar mensajero" }).click();
  // Feature 148 (§9.7): el modal ya NO se cierra al confirmar; pasa a la fase
  // "resultado" (resumen de la asignación ya cometida + botón del manifiesto del
  // lote) y el refresco del listado se difiere al cierre de esa fase.
  await expect(
    modal.getByRole("button", { name: /Descargar manifiesto/i }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Cerrar" }).click();
  await expect(modal).toBeHidden();
  await logout(page);
}

/** Abre el drawer "Ver historial" de la orden semilla y devuelve su dialog. */
async function abrirHistorial(page: Page) {
  await page.getByRole("button", { name: TRIGGER_NAME }).click();
  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe.serial("Reintentos y escalado — 3 devoluciones → rechazada (R8/R9/R15)", () => {
  test("tres devoluciones consecutivas (con re-asignación) escalan la orden a rechazada", async ({
    page,
  }) => {
    // 1ª devolución (intento 1 < umbral) → vuelve a bodega (R9) → re-asignar.
    await mensajeroDevuelveOrden(page);
    await maestroReasignaDesdeBodega(page);

    // 2ª devolución (intento 2 < umbral) → vuelve a bodega (R9) → re-asignar.
    await mensajeroDevuelveOrden(page);
    await maestroReasignaDesdeBodega(page);

    // 3ª devolución (intento 3 == umbral) → ESCALA a rechazada (R8); NO vuelve a
    // bodega, así que no hay re-asignación posible después.
    await mensajeroDevuelveOrden(page);

    // El adminTienda dueño ve la orden ya rechazada en el listado plano y confirma
    // que NO reaparece como asignable en "En bodega" (escaló, no volvió a bodega).
    await login(page, ADMIN_TIENDA_EMAIL, ADMIN_TIENDA_PASSWORD);
    await page.goto("/ordenes");
    await expect(page.getByRole("button", { name: TRIGGER_NAME })).toBeVisible();
  });

  test("el drawer muestra el badge 'Intento 3 de 3' y el escalado en la línea de tiempo", async ({
    page,
  }) => {
    await login(page, ADMIN_TIENDA_EMAIL, ADMIN_TIENDA_PASSWORD);
    await page.goto("/ordenes");

    const dialog = await abrirHistorial(page);
    await expect(
      dialog.getByRole("heading", { name: DIALOG_TITLE }),
    ).toBeVisible();

    // R15 — badge del conteo de intentos DERIVADO: "Intento 3 de 3".
    const badge = dialog.getByRole("status", { name: /Intentos de entrega/i });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(BADGE_TEXT);
    await expect(dialog.getByText(BADGE_TEXT)).toBeVisible();

    // R16/R30 — línea de tiempo con etiquetas legibles, sin UUIDs.
    const timeline = dialog.getByRole("list", {
      name: "Línea de tiempo de estados",
    });
    await expect(timeline).toBeVisible();
    await expect(dialog.getByText(UUID_RE)).toHaveCount(0);

    // R9 — las TRES devoluciones (una por intento) aparecen en la línea de tiempo.
    //
    // 2026-08-19 (feature 239): cada intento deja AHORA DOS filas, no una — la gestión del
    // mensajero («Devolución por confirmar») y la aprobación del cierre («Devuelta»)—. Si esta
    // spec llegara a ejecutarse alguna vez y la segunda no apareciera, sería la señal de que la
    // devolución se quedó sin anclar: invisible para la tienda y con el reloj parado.
    await expect(dialog.getByText(LABEL_PRE_CONFIRMACION)).toHaveCount(UMBRAL);
    await expect(dialog.getByText(LABEL_DEVUELTA)).toHaveCount(UMBRAL);
    // R9 — los reintentos 1º y 2º dejaron la orden en bodega (seguimiento a
    // `en_bodega_central`): dos filas "En bodega".
    await expect(dialog.getByText(LABEL_BODEGA)).toHaveCount(UMBRAL - 1);

    // R8 — la 3ª devolución escaló a "Rechazada" (estado FINAL), disparada por el
    // SISTEMA (actor NULL → "Sistema"), como ÚLTIMA entrada de la línea de tiempo.
    const entradas = timeline.getByRole("listitem");
    const ultima = entradas.last();
    await expect(ultima.getByText(LABEL_RECHAZADA)).toBeVisible();
    await expect(ultima.getByText(`Por ${ACTOR_SISTEMA}`)).toBeVisible();
  });
});
