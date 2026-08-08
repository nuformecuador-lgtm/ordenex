import { test, expect, type Page } from "@playwright/test";

/**
 * E2E de "/analitica" — LOS RECORTES POR ROL (Feature 133, T7.1 / R28; deber heredado de
 * la 132, Q5: «el E2E se hace una sola vez en la 133»).
 *
 * QUE PRUEBA ESTE ARCHIVO Y QUE NO. Esto es un recorte de PRESENTACION: comprueba QUE SE
 * PINTA en la pantalla de cada rol. **Un panel que no se pinta NO es un dato que no se
 * filtra.** El recorte de DATOS lo garantiza la 122 (`lib/analytics/alcance.ts`,
 * `lib/analytics/alcance-columnas.ts`), en el SERVIDOR y antes de tocar la base, y NINGUNA
 * aserción de este archivo lo prueba ni lo sustituye
 * (`specs/133-analitica-recortes-por-rol/requirements.md §0`, R20/R21).
 *
 * Recorrido de CUATRO roles (Q6, cerrada):
 *
 *  1. `adminTienda`, `adminSatelite` y `mensajero` entran a `/analitica` —la 133 les abre la
 *     ruta (R1)—, ven el TABLERO OPERATIVO con sus SEIS paneles (R11) y NO queda RASTRO de la
 *     región financiera (R6/R7): ni la región, ni su encabezado, ni una etiqueta de métrica
 *     financiera, ni cifras de dinero, ni símbolo de moneda, ni un «sin movimientos» en su
 *     lugar, ni un enlace o botón que anuncie que la región existe (R10).
 *  2. `maestro` SI la ve. Es el CONTROL POSITIVO y no es decorado: sin él, el caso 1 podría
 *     pasar por vacío —una página que no cargara en absoluto (login roto, 404, servidor
 *     caído) no contiene la palabra «financiero» y daría verde—. Con él, la ausencia de
 *     arriba es una ausencia CON SIGNIFICADO: esos mismos textos SI llegan al documento
 *     cuando el rol tiene acceso.
 *  3. Las FACETAS que la 133 recorta (R14/R15/R17): `adminTienda` sin «Tienda» ni
 *     «Mensajero», `adminSatelite` sin «Zona», `mensajero` sin «Mensajero»; y los CUATRO
 *     con «Rango», que no se le quita a nadie.
 *
 * R27 — OJO CON LEER DE MAS EL CASO DE `adminTienda`: que no se le ofrezca el selector
 * «Mensajero» NO cierra el oráculo residual contra R39 de la 122 (hallazgo M-4 de
 * `progress/review_122.md`, ficha 182). El `mensajero_id` sigue viajando por la URL y por el
 * argumento de la Server Action: la prohibición efectiva es del BORDE, no de esta pantalla.
 * Ver `requirements.md §4`.
 *
 * QUE MUTACION MATA (criterio de hecho de T7.1): pasar la prop `financiero` a un rol acotado
 * en `app/(app)/analitica/page.tsx`. Con esa mutación, el caso 1 falla por la región, por la
 * etiqueta de métrica y por el símbolo de moneda, los tres por separado.
 *
 * Los oráculos de abajo (títulos de panel, etiquetas financieras, nombres de región) se
 * escriben A MANO a propósito: derivarlos de `catalogo-paneles.ts` o de `lib/analytics/
 * metrics.ts` convertiría el test en una tautología del código que juzga —y además metería
 * el catálogo de métricas, que es dato de SERVIDOR, dentro del proceso de test.
 *
 * PRECONDICION (seed): cuatro usuarios con sesión iniciable, uno por rol —`maestro`,
 * `adminTienda`, `adminSatelite`, `mensajero`—. El `adminTienda` con su tienda asignada y el
 * `adminSatelite` con su zona, para que `resolverAlcance` no les deniegue (R13 de la 122);
 * el tablero se pinta igual si deniega, pero el caso de facetas es más significativo con el
 * alcance resuelto. NO hace falta ningún dato financiero sembrado: el control positivo
 * afirma la REGION y su etiqueta de métrica, que se pintan aunque no haya movimientos.
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres and the migrations applied
 * - The four seeded users of the PRECONDITION above
 *
 * If the environment lacks .env or a real database, these tests are WRITTEN but NOT
 * EXECUTED. Execution is deferred until the test environment is fully set up (same deferral
 * as e2e/wallet-mensajeros.spec.ts, e2e/reprogramacion-liberacion.spec.ts y
 * e2e/cierre-dia.spec.ts). They do NOT run under `pnpm test`.
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed the four users per PRECONDITION and set the constants below
 * 4. Run tests: pnpm run test:e2e
 */

/* -------------------------------------------------------------------------- */
/* Credenciales sembradas (una por rol del recorrido)                          */
/* -------------------------------------------------------------------------- */

const PASSWORD = "correct-password";

const MAESTRO_EMAIL = "maestro@example.com";
const ADMIN_TIENDA_EMAIL = "admin-tienda@example.com";
const ADMIN_SATELITE_EMAIL = "admin-satelite@example.com";
const MENSAJERO_EMAIL = "mensajero@example.com";

/* -------------------------------------------------------------------------- */
/* Oráculos, escritos a mano (no derivados del código que juzgan)              */
/* -------------------------------------------------------------------------- */

/** Nombre accesible de la región que la 133 prohíbe a los roles acotados. */
const REGION_FINANCIERA = "Tablero financiero";

/** Nombre accesible de la región que los CINCO lectores SI ven. */
const REGION_OPERATIVA = "Tablero operativo";

/** Los SEIS paneles operativos: se pintan para los cinco roles (R11). */
const PANELES_OPERATIVOS = [
  "Órdenes creadas",
  "Órdenes por estado",
  "Resultado de las gestiones",
  "Órdenes sin gestionar",
  "Tasa de entrega",
  "Tiempo de ciclo",
] as const;

/**
 * Etiquetas de las métricas financieras. Para un rol acotado NINGUNA puede aparecer (R7);
 * para el `maestro` tienen que aparecer, o el control positivo no controla nada.
 */
const ETIQUETAS_FINANCIERAS = [
  "COD recaudado",
  "Ingreso por flete",
  "Ingreso por comisión COD",
  "Ingreso por IVA",
  "Egresos",
  "Cuenta por pagar a tiendas",
  "Cuenta por pagar a mensajeros",
  "Conciliación de cierres",
] as const;

/**
 * R7 nombra explícitamente «ninguna cifra de dinero». Un total puede pintarse formateado
 * (`₡918 273,45`), y entonces la cifra cruda no aparece pero el SIMBOLO sí: se censa aparte.
 */
const SIMBOLOS_MONEDA = ["₡", "$", "€", "CRC", "USD"] as const;

/** Los tres roles que la 133 deja entrar SIN dinero. */
const ROLES_ACOTADOS = [
  { rol: "adminTienda", email: ADMIN_TIENDA_EMAIL },
  { rol: "adminSatelite", email: ADMIN_SATELITE_EMAIL },
  { rol: "mensajero", email: MENSAJERO_EMAIL },
] as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Inicia sesión con las credenciales dadas y aterriza en la app. */
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 5000 });
}

/**
 * Entra a `/analitica` y espera a que la página esté PINTADA (encabezado + región
 * operativa). Sin esta espera, un censo de texto sobre un documento a medio montar sería
 * otra forma de pasar por vacío.
 */
async function irAAnalitica(page: Page) {
  await page.goto("/analitica");
  await expect(page.getByRole("heading", { name: "Analítica" })).toBeVisible();
  await expect(page.getByRole("region", { name: REGION_OPERATIVA })).toBeVisible();
}

/* -------------------------------------------------------------------------- */
/* 1 y 2 — la región financiera: PROHIBIDA para tres, VISIBLE para el maestro   */
/* -------------------------------------------------------------------------- */

test.describe("Analítica por rol — el tablero operativo se ve y del dinero no queda rastro", () => {
  for (const { rol, email } of ROLES_ACOTADOS) {
    test(`el rol \`${rol}\` ve el tablero operativo y NI RASTRO de la región financiera (R6, R7, R10, R11)`, async ({
      page,
    }) => {
      await login(page, email, PASSWORD);
      await irAAnalitica(page);

      // R11 — los SEIS paneles operativos. Ningún panel se retira por rol: las 15 métricas
      // operativas son `acotado` (no `prohibido`) para los cinco lectores. Cada panel es una
      // región con su título como nombre accesible, en CUALQUIERA de sus estados (ok,
      // cargando, forbidden, error…), así que esta aserción no depende de que haya datos.
      const operativo = page.getByRole("region", { name: REGION_OPERATIVA });
      for (const titulo of PANELES_OPERATIVOS) {
        await expect(operativo.getByRole("region", { name: titulo })).toBeVisible();
      }

      // EL ANTI-VACIO: hay documento. Sin esto, todo lo que sigue lo cumpliría una página
      // en blanco.
      const cuerpo = await page.locator("body").innerText();
      expect(cuerpo.length).toBeGreaterThan(0);

      // El censo del TEXTO va primero, a propósito: si fuese detrás del `toHaveCount(0)` de
      // la región, cualquier mutación que la pintase abortaría el caso ahí y nadie sabría si
      // las aserciones sobre el texto llegan a ejecutarse. Aquí, el fallo NOMBRA el texto
      // que se coló.
      expect(cuerpo).not.toContain("financiero");
      expect(cuerpo).not.toContain("Financiero");
      expect(cuerpo).not.toContain("financiera");
      expect(cuerpo).not.toContain("Financiera");
      for (const etiqueta of ETIQUETAS_FINANCIERAS) {
        expect(cuerpo).not.toContain(etiqueta);
      }
      // Ni un estado vacío del tablero financiero en su lugar (R6): «una región financiera
      // visible y vacía es peor que no tenerla».
      expect(cuerpo.toLowerCase()).not.toContain("sin movimientos");
      // R7 — ni un símbolo de moneda, que es lo que sobreviviría a un formateo.
      for (const simbolo of SIMBOLOS_MONEDA) {
        expect(cuerpo).not.toContain(simbolo);
      }

      // R6 — la región no existe. No está oculta ni vacía: no está.
      await expect(page.getByRole("region", { name: REGION_FINANCIERA })).toHaveCount(0);

      // R10 — ni un control de navegación que ANUNCIE que la región existe.
      await expect(page.getByRole("link", { name: /financier/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /financier/i })).toHaveCount(0);
    });
  }

  test("CONTROL POSITIVO: el `maestro` SI ve la región financiera con su etiqueta de métrica", async ({
    page,
  }) => {
    // Sin este caso, los tres de arriba podrían estar comprobando la ausencia de textos que
    // la pantalla no pinta NUNCA, para nadie —o peor, la ausencia de todo porque la página
    // no cargó—. Aquí se demuestra que esos mismos textos SI llegan al documento cuando el
    // rol tiene acceso total.
    await login(page, MAESTRO_EMAIL, PASSWORD);
    await irAAnalitica(page);

    const financiero = page.getByRole("region", { name: REGION_FINANCIERA });
    await expect(financiero).toBeVisible();

    // Al menos una etiqueta de métrica financiera, de las que los tres roles acotados no
    // pueden tener delante. `first()` porque `COD recaudado` aporta DOS vistas.
    await expect(
      financiero.getByText(new RegExp(ETIQUETAS_FINANCIERAS.join("|"))).first(),
    ).toBeVisible();

    // Y el maestro conserva el tablero operativo entero: la región financiera se SUMA, no
    // sustituye.
    const operativo = page.getByRole("region", { name: REGION_OPERATIVA });
    for (const titulo of PANELES_OPERATIVOS) {
      await expect(operativo.getByRole("region", { name: titulo })).toBeVisible();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3 — las facetas de filtro que el alcance del actor ya tiene fijadas          */
/* -------------------------------------------------------------------------- */

/**
 * Los selectores de dimensión son `MultiSelectFilter`: su disparador es un botón cuyo nombre
 * accesible es `«<Etiqueta>: <resumen>»` (p. ej. «Zona: Todos»), de ahí el `/^Zona:/`. El
 * rango es un `combobox` llamado «Rango».
 *
 * R16 — «no ofrecer es no dibujar»: la faceta ausente no aparece deshabilitada ni con la
 * nota de degradado en su lugar. Por eso se afirma `toHaveCount(0)` sobre el nombre del
 * disparador, que existiría igual si el selector estuviera apagado.
 */
test.describe("Analítica por rol — las facetas fijadas por el alcance no se ofrecen", () => {
  test("`adminTienda` no ve «Tienda» ni «Mensajero», y sí «Rango» (R14, R15, R17)", async ({
    page,
  }) => {
    await login(page, ADMIN_TIENDA_EMAIL, PASSWORD);
    await irAAnalitica(page);

    await expect(page.getByRole("combobox", { name: "Rango" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Tienda:/ })).toHaveCount(0);
    // R15 — el desplegable de mensajeros le serviría NOMBRE REAL + uuid de cada uno
    // (`UsuariosPorRolService` SI le autoriza ese catálogo), que es justo lo que la identidad
    // seudónima de la 122 existe para impedir.
    // R27 — y esto NO cierra el oráculo residual contra R39 de la 122 (M-4, ficha 182): el
    // `mensajero_id` sigue viajando por la URL y por la Server Action. Decide el BORDE.
    await expect(page.getByRole("button", { name: /^Mensajero:/ })).toHaveCount(0);
  });

  test("`adminSatelite` no ve «Zona», y sí «Rango» (R14, R17)", async ({ page }) => {
    await login(page, ADMIN_SATELITE_EMAIL, PASSWORD);
    await irAAnalitica(page);

    await expect(page.getByRole("combobox", { name: "Rango" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Zona:/ })).toHaveCount(0);
  });

  test("`mensajero` no ve «Mensajero», y sí «Rango» (R14, R17)", async ({ page }) => {
    await login(page, MENSAJERO_EMAIL, PASSWORD);
    await irAAnalitica(page);

    await expect(page.getByRole("combobox", { name: "Rango" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Mensajero:/ })).toHaveCount(0);
  });

  test("`maestro` conserva «Rango» (R17) — el selector de rango no se le quita a nadie", async ({
    page,
  }) => {
    await login(page, MAESTRO_EMAIL, PASSWORD);
    await irAAnalitica(page);

    await expect(page.getByRole("combobox", { name: "Rango" })).toBeVisible();
  });
});
