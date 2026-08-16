import { test, expect } from "@playwright/test";

/**
 * E2E — Rastreo público del envío desde la landing (Feature 229, T5.1).
 *
 * Cubre de punta a punta:
 *  - **R2** — la consulta se procesa SIN cookie de sesión: no redirige a `/login` ni exige
 *    autenticación. La Server Action se postea a `/`, que el middleware deja pasar por
 *    coincidencia EXACTA (`middleware.ts:62-65`); por eso esta feature no toca el middleware.
 *  - **R26** — el resultado se pinta DENTRO del mismo diálogo, sin navegar: la URL no cambia.
 *  - **R7** — guía inexistente y segundo factor errado producen el MISMO texto. Es el
 *    mecanismo anti-enumeración: `num_guia` es incremental y contiguo (`db/schema.prisma:483`),
 *    así que un borde que distinguiera «no existe» de «factor errado» sería un oráculo de la
 *    base de envíos aunque nunca acertara el factor.
 *
 * SIN SESIÓN, Y ES LA MITAD DEL PUNTO. Cada test corre con `storageState` vacío: con cookie,
 * `/` redirige a `/dashboard` (`middleware.ts:62-64`) y el modal es INALCANZABLE — consecuencia
 * aceptada y declarada del gate (design §0, F6). Si estos tests empezaran a fallar con un
 * «no se encontró el botón Rastrear envío», lo primero que hay que mirar es si el contexto
 * arrastra una sesión.
 *
 * SUPERFICIE (verificada en el código):
 *  - `app/_landing/LandingNav.tsx` monta `RastreoDialog` y le pasa el aspecto y el texto del
 *    botón «Rastrear envío», que hasta esta feature estaba `disabled`.
 *  - El diálogo (`role="dialog"`, título «Rastrear envío») lleva dos campos localizables por
 *    su etiqueta —«Número de guía» y «Últimos 4 dígitos del teléfono»— y el botón «Consultar».
 *  - El resultado es una `<ol>` de hitos públicos (`role="listitem"` por hito) con la guía
 *    consultada arriba. El rechazo es un `role="alert"` con texto único.
 *
 * PRECONDITION (seed):
 *  - Una orden VIVA (`deleted_at` nulo) con `num_guia` = GUIA_SEMBRADA y `telefono_dest` cuyos
 *    últimos 4 dígitos sean FACTOR_SEMBRADO, y con AL MENOS una fila en
 *    `orden_historial_estado` (si no tiene ninguna, no hay nada OCURRIDO que contar y el
 *    servidor responde igual que «no encontrado», G10/R14).
 *  - Una guía que NO exista en la base: GUIA_INEXISTENTE.
 *  - El limitador de intentos es 8 en 10 minutos por IP (G4): esta suite hace 3 consultas, así
 *    que cabe de sobra. Si se añaden casos, ojo con el techo — un `demasiados_intentos`
 *    aparecería como un fallo raro y difícil de leer.
 *
 * EXECUTION NOTE (misma deferral que el resto de `e2e/` en este repo):
 * Estos tests requieren un servidor Next levantado (`pnpm dev`, lo hace el `webServer` de
 * `playwright.config.ts`) y una base con el seed de arriba. Sin `.env` ni base real están
 * ESCRITOS pero NO EJECUTADOS. No corren bajo `pnpm test` (vitest solo incluye `tests/**`).
 *
 * Para correrlos:
 *  1. `.env` con credenciales de base y migraciones aplicadas (`pnpm run db:migrate`).
 *  2. Sembrar la orden de la PRECONDITION y ajustar las constantes de abajo (o pasarlas por
 *     `E2E_RASTREO_GUIA` / `E2E_RASTREO_FACTOR` / `E2E_RASTREO_GUIA_INEXISTENTE`).
 *  3. `pnpm run test:e2e`.
 *
 * EJECUTADOS UNA VEZ, y conviene decir contra qué: el 2026-08-15, contra un `next dev` de este
 * worktree y la base local, pasando la guía real por entorno
 * (`E2E_RASTREO_GUIA` / `E2E_RASTREO_FACTOR`) porque las constantes de abajo son un seed
 * genérico que esa base no tiene. Los dos casos pasaron. NO se corrieron con el `webServer` de
 * `playwright.config.ts`: ese reutiliza el servidor que ya esté en `localhost:3000`, que puede
 * ser el de otro checkout — si estos tests fallan con «el botón sigue deshabilitado», es eso.
 */

/** Guía sembrada, viva y con historial. */
const GUIA_SEMBRADA = process.env.E2E_RASTREO_GUIA ?? "1001";
/** Últimos 4 dígitos del teléfono del destinatario de esa orden (segundo factor, G1). */
const FACTOR_SEMBRADO = process.env.E2E_RASTREO_FACTOR ?? "8899";
/** Una guía que no existe en la base. */
const GUIA_INEXISTENTE = process.env.E2E_RASTREO_GUIA_INEXISTENTE ?? "99999999";

/** El texto ÚNICO de rechazo (R28). Se escribe aquí una vez y se compara consigo mismo. */
const RECHAZO_UNICO =
  "No encontramos un envío con esos datos. Revisa el número de guía y los últimos 4 dígitos del teléfono.";

// Contexto LIMPIO: ni cookie de sesión ni almacenamiento previo.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Feature 229 — rastreo público sin sesión", () => {
  test("un visitante sin sesión consulta su envío desde la landing", async ({ page }) => {
    await page.goto("/");

    // R2 — sin cookie, `/` sirve la landing: no hay redirección a `/login`.
    await expect(page).toHaveURL(/\/$/);
    const urlAntes = page.url();

    const disparador = page.getByRole("button", { name: /Rastrear envío/ });
    await expect(disparador).toBeEnabled(); // R1: dejó de ser inerte
    await disparador.click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Rastrear envío" })).toBeVisible();

    await dialogo.getByLabel("Número de guía").fill(GUIA_SEMBRADA);
    await dialogo.getByLabel("Últimos 4 dígitos del teléfono").fill(FACTOR_SEMBRADO);
    await dialogo.getByRole("button", { name: "Consultar" }).click();

    // R26 — la línea de tiempo aparece DENTRO del mismo diálogo…
    await expect(dialogo.getByText(new RegExp(`Guía ${GUIA_SEMBRADA}`))).toBeVisible();
    await expect(dialogo.getByRole("listitem").first()).toBeVisible();
    await expect(dialogo.getByRole("alert")).toHaveCount(0);

    // …y NO se navegó: ni ruta nueva, ni la guía en la URL (R30/F2).
    expect(page.url()).toBe(urlAntes);
    await expect(page).toHaveURL(/\/$/);
  });

  test("los dos casos malos muestran el mismo texto", async ({ page }) => {
    // R7 — el servidor responde de forma IDÉNTICA cuando la guía no existe y cuando el
    // segundo factor no coincide. Si algún día divergen, este test lo dice con las dos
    // cadenas delante.
    const consultar = async (guia: string, factor: string): Promise<string> => {
      await page.goto("/");
      await page.getByRole("button", { name: /Rastrear envío/ }).click();
      const dialogo = page.getByRole("dialog");
      await expect(dialogo).toBeVisible();
      await dialogo.getByLabel("Número de guía").fill(guia);
      await dialogo.getByLabel("Últimos 4 dígitos del teléfono").fill(factor);
      await dialogo.getByRole("button", { name: "Consultar" }).click();

      const alerta = dialogo.getByRole("alert");
      await expect(alerta).toBeVisible();
      // R28 — un rechazo no pinta línea de tiempo alguna.
      await expect(dialogo.getByRole("listitem")).toHaveCount(0);
      return (await alerta.textContent())?.trim() ?? "";
    };

    const guiaInexistente = await consultar(GUIA_INEXISTENTE, FACTOR_SEMBRADO);
    const factorErrado = await consultar(GUIA_SEMBRADA, "0000");

    expect(guiaInexistente).toBe(RECHAZO_UNICO);
    expect(
      factorErrado,
      "el rechazo por factor errado dejó de ser idéntico al de guía inexistente: el borde " +
        "público pasó a filtrar la EXISTENCIA de la guía, que es media enumeración (R7)",
    ).toBe(guiaInexistente);
  });
});
