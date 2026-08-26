import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Feature 284 (B2 de la revisión, 2026-08-25) — GUARDIA DE «LA PWA SE SIRVE SIN SESIÓN».
//
// ## El defecto que esta guardia existe para que no vuelva
//
// Medido contra **producción real** (`ordenex.vercel.app`), no en local:
//
//     /manifest.json       307 -> /login?redirect=%2Fmanifest.json
//     /sw.js               307 -> /login?redirect=%2Fsw.js
//     /offline.html        307 -> /login?redirect=%2Foffline.html
//     /icons/icon-512.png  200
//
// El `matcher` del middleware sólo excluía **extensiones de imagen**, así que los iconos pasaban
// y los tres archivos que HACEN la PWA no. El navegador pide el manifiesto **sin credenciales**:
// recibía el redirect y **jamás ofrecía instalar**. El service worker tampoco se descargaba, o
// sea que ni la caché, ni el relevo, ni la pantalla offline llegaban nunca al dispositivo.
//
// Es un fallo MUDO de manual: la app se ve perfecta, los iconos cargan, y lo único que pasa es
// que el botón de instalar no aparece nunca. Nadie lo iba a notar mirando la pantalla.
//
// ## Por qué se comprueba aquí y no con un test de integración
//
// Porque lo que decide esto es un **literal de configuración** que nadie importa: ningún grafo
// de imports selecciona un test cuando alguien edita `config.matcher`. Vive en `guards/`, que
// corre siempre (R24). La comprobación empírica (`curl -I` contra un build de producción) está
// en `progress/impl_284.md`, y la re-comprobación en el despliegue, en `docs/release.md`.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const MIDDLEWARE = fs.readFileSync(path.join(RAIZ, "middleware.ts"), "utf8");
const LAYOUT = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");

/** El `matcher` tal cual lo compila Next: se lee del fuente y se convierte en RegExp. */
function matcherDelMiddleware(): RegExp {
  const desde = MIDDLEWARE.indexOf("matcher: [");
  expect(desde, "no se encontró `matcher: [` en middleware.ts").toBeGreaterThan(-1);
  const literal = /"((?:[^"\\]|\\.)*)"/.exec(MIDDLEWARE.slice(desde));
  expect(literal, "no se encontró el patrón del matcher").not.toBeNull();
  const patron = JSON.parse(literal![0]) as string;
  // Autocomprobación del extractor: si esto deja de parecerse a un matcher, el resto de la
  // guardia estaría afirmando sobre otra cosa.
  expect(patron.startsWith("/((?!")).toBe(true);
  return new RegExp("^" + patron + "$");
}

const matcher = matcherDelMiddleware();

/** `true` = la petición ENTRA al middleware (y por tanto exige sesión). */
function pasaPorElGuard(ruta: string): boolean {
  return matcher.test(ruta);
}

const ARCHIVOS_DE_LA_PWA = ["/manifest.json", "/sw.js", "/offline.html"];

describe("pwa · el manifiesto, el service worker y el offline se sirven sin sesión", () => {
  it.each(ARCHIVOS_DE_LA_PWA)("%s no pasa por el guard de sesión", (ruta) => {
    expect(
      pasaPorElGuard(ruta),
      `${ruta} vuelve a estar detrás del login: el navegador lo pide SIN credenciales y recibiría un 307`,
    ).toBe(false);
  });

  it.each(ARCHIVOS_DE_LA_PWA)("%s existe de verdad en public/", (ruta) => {
    expect(fs.existsSync(path.join(RAIZ, "public", ruta))).toBe(true);
  });

  it("los iconos siguen pasando por la exclusión de imágenes", () => {
    // Esta es la parte que YA funcionaba, y es justo lo que hacía el defecto tan difícil de ver.
    expect(pasaPorElGuard("/icons/icon-512.png")).toBe(false);
    expect(pasaPorElGuard("/icons/icon-180.png")).toBe(false);
    expect(pasaPorElGuard("/screenshots/inicio-narrow.png")).toBe(false);
  });

  it("ANTI-VACUIDAD: el resto de la app sigue detrás del guard", () => {
    // Sin este caso, «no pasa por el guard» estaría verde con un matcher que no protege nada.
    for (const ruta of [
      "/ordenes",
      "/dashboard",
      "/cierre-dia",
      "/mis-asignaciones/reparto",
      "/configuracion",
      "/api/ordenes",
      "/wallet",
    ]) {
      expect(pasaPorElGuard(ruta), `${ruta} se quedó FUERA del guard de sesión`).toBe(true);
    }
  });

  it("la exclusión va por NOMBRE y no por extensión", () => {
    // Excluir `.json`, `.js` o `.html` a secas sí aflojaría de verdad: dejaría fuera del guard
    // cualquier ruta futura con esa terminación.
    const patron = matcher.source;
    expect(patron).toContain("manifest");
    expect(patron).toContain("offline");
    expect(patron).not.toMatch(/\|\.\*\\\.\(\?:.*json/);
    expect(pasaPorElGuard("/reportes/export.json")).toBe(true);
    expect(pasaPorElGuard("/algo/sw.js")).toBe(true);
  });

  it("el <link rel=\"manifest\"> NO declara crossorigin, y hay una razón medida", () => {
    // R26. `crossorigin="use-credentials"` sólo hace falta si el manifiesto DEPENDE de la
    // sesión. Medido tras el arreglo con `curl -I` sobre un build de producción: el manifiesto
    // responde **200 sin ninguna cookie** y su contenido es un archivo estático igual para
    // todos, así que pedirlo con credenciales no cambiaría ni una respuesta — y sí traería el
    // problema de A11 (`design.md` §5): un manifiesto por sesión se **congela** al instalar y
    // deja los datos de un rol grabados en el icono.
    const enlace = /<link[^>]*rel="manifest"[^>]*\/>/.exec(LAYOUT)?.[0];
    expect(enlace, "no se encontró el <link rel=\"manifest\">").toBeDefined();
    expect(enlace).not.toContain("crossorigin");
  });

  it("el service worker se registra en la raíz del scope", () => {
    // Si el registro apuntara a una subruta, su scope dejaría fuera media app — y ahí el
    // arreglo del matcher no serviría de nada.
    expect(LAYOUT).toContain("navigator.serviceWorker.register('/sw.js')");
  });
});
