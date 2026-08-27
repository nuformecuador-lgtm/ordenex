import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 286 (T14, R2) — GUARDIA: UNA SOLA MAQUETA DE CONTRASEÑA.
 *
 * Es la capa que sigue viva cuando ya nadie lea el spec. Lo que vigila:
 *
 *  1. **Prohibición.** Ningún `.tsx` de `app/` ni de `components/` declara un
 *     `type="password"` a pelo. El día que aparezca un séptimo campo de contraseña, esto
 *     se pone ROJO hasta que use el componente compartido. Ese es el punto: la alternativa
 *     descartada era seis toggles copiados en cuatro formularios, y este repo ya pagó esa
 *     factura —los dos generadores de etiquetas PDF se declaraban «espejo EXACTO» y
 *     llevaban una feature entera sin serlo—.
 *  2. **Control positivo.** `PasswordInput.tsx` SÍ enmascara. Sin esta capa, bastaría con
 *     que alguien vaciara el componente para que la prohibición de arriba quedara verde
 *     para siempre con la app rota (y con las contraseñas en claro, que es peor).
 *  3. **Superficie.** Los cuatro archivos del censo importan `PasswordInput`, y con el
 *     recuento de usos del censo (1, 1, 2, 2). Esto ataja el fallo mudo de «sustituyeron
 *     cinco y se dejaron uno», que ninguna de las otras dos capas ve.
 *
 * Lee con `codigoSinComentarios` a propósito: así un `type="password"` mencionado en un
 * comentario —los hay, en la cabecera del propio componente— no la dispara, y un
 * `PasswordInput` comentado tampoco la engaña.
 */

const RAIZ = path.resolve(__dirname, "../../..");

const COMPONENTE = "components/shared/PasswordInput.tsx";

/** Las carpetas que se barren enteras. `e2e/` queda fuera: ahí `input[type="password"]`
 *  es un SELECTOR de Playwright sobre el DOM que este componente sigue produciendo, no
 *  una maqueta propia. */
const CARPETAS_BARRIDAS = ["app", "components"];

/**
 * El censo verificado el 2026-08-26, con el número de campos de contraseña de cada
 * archivo. Es una lista literal escrita a mano: si se deriva del árbol, se compara el
 * árbol consigo mismo y sale verde siempre.
 */
const CENSO: Array<{ archivo: string; usos: number }> = [
  { archivo: "app/(app)/configuracion/_components/UsuarioForm.tsx", usos: 1 },
  { archivo: "app/login/_components/LoginForm.tsx", usos: 1 },
  { archivo: "app/postulacion/_components/PostulacionForm.tsx", usos: 2 },
  {
    archivo: "app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx",
    usos: 2,
  },
];

function tsxDe(carpeta: string): string[] {
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada.startsWith(".")) continue;
      const absoluta = path.join(dir, entrada);
      if (statSync(absoluta).isDirectory()) {
        recorrer(absoluta);
      } else if (entrada.endsWith(".tsx")) {
        encontrados.push(path.relative(RAIZ, absoluta).split(path.sep).join("/"));
      }
    }
  };
  recorrer(path.join(RAIZ, carpeta));
  return encontrados;
}

describe("R2 — la maqueta del campo de contraseña vive en UN solo sitio", () => {
  it("ningún .tsx de app/ ni components/ declara `type=\"password\"` por su cuenta", () => {
    const archivos = CARPETAS_BARRIDAS.flatMap(tsxDe).filter((f) => f !== COMPONENTE);

    // No puede quedarse vacío: si el barrido deja de encontrar archivos, la prohibición
    // sería vacía y esta guardia mentiría en verde.
    expect(archivos.length).toBeGreaterThan(100);

    const reincidentes = archivos.filter((archivo) =>
      /type\s*=\s*"password"/.test(codigoSinComentarios(archivo)),
    );

    expect(
      reincidentes,
      `estos archivos arman su propio campo de contraseña: ${reincidentes.join(", ")}. ` +
        `La maqueta del ojito vive en ${COMPONENTE} y sólo ahí; un campo nuevo se hace ` +
        `con <PasswordInput etiqueta="..." />, no copiando el toggle.`,
    ).toEqual([]);
  });

  it("el componente compartido SÍ enmascara (si no, la prohibición de arriba sería vacía)", () => {
    const codigo = codigoSinComentarios(COMPONENTE);

    // El `type` es una EXPRESIÓN, no un literal: `type={visible ? "text" : "password"}`.
    // Por eso el control positivo se afirma sobre la expresión y no sobre la cadena
    // `type="password"`, que en este archivo sólo aparece en los comentarios (y los
    // comentarios ya no están aquí).
    expect(
      /type\s*=\s*\{[^}]*"password"[^}]*\}/.test(codigo),
      `${COMPONENTE} ya no enmascara: sin un \`type\` que valga "password" en reposo, el ` +
        "campo enseña la contraseña sola y la prohibición de la capa 1 queda verde para " +
        "siempre sobre una app rota.",
    ).toBe(true);

    // Y sigue ofreciendo el otro estado: un componente que sólo enmascara no es un ojito.
    expect(/type\s*=\s*\{[^}]*"text"[^}]*\}/.test(codigo)).toBe(true);
  });

  it("los cuatro archivos del censo usan el componente compartido, con el recuento del censo", () => {
    const desviaciones: string[] = [];

    for (const { archivo, usos } of CENSO) {
      const codigo = codigoSinComentarios(archivo);

      if (!/import\s*\{[^}]*\bPasswordInput\b[^}]*\}\s*from\s*"@\/components\/shared\/PasswordInput"/.test(codigo)) {
        desviaciones.push(`${archivo}: no importa PasswordInput`);
        continue;
      }

      const encontrados = (codigo.match(/<PasswordInput\b/g) ?? []).length;
      if (encontrados !== usos) {
        desviaciones.push(
          `${archivo}: ${encontrados} <PasswordInput> y el censo dice ${usos}`,
        );
      }
    }

    expect(
      desviaciones,
      "el censo de campos de contraseña no cuadra con el árbol. O se sustituyó de menos " +
        "(un campo se quedó sin ojito y nadie lo ve), o apareció uno nuevo y hay que " +
        "meterlo en el censo de esta guardia a propósito.",
    ).toEqual([]);
  });

  it("cada uso del componente le pasa su etiqueta visible (dos ojitos no pueden llamarse igual)", () => {
    // R14: el nombre accesible se construye con `etiqueta`. Si un consumidor la olvidara,
    // TypeScript ya se queja (es obligatoria), pero pasarle una cadena vacía compila: dos
    // botones «: oculta. Mostrar.» indistinguibles en la misma pantalla.
    const sinEtiqueta: string[] = [];

    for (const { archivo } of CENSO) {
      const codigo = codigoSinComentarios(archivo);
      for (const uso of codigo.match(/<PasswordInput\b[\s\S]*?\/>/g) ?? []) {
        if (!/\betiqueta=\{?["{]/.test(uso) || /\betiqueta=""/.test(uso)) {
          sinEtiqueta.push(`${archivo}: ${uso.slice(0, 60).replace(/\s+/g, " ")}…`);
        }
      }
    }

    expect(sinEtiqueta).toEqual([]);
  });
});
