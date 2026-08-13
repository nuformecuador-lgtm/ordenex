import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";

import { TOPE_PUNTOS_SERIE } from "@/lib/analytics/types";
import { MAX_PUNTOS_SERIE } from "@/components/private/analytics/topes";

// Feature 180 (T1.3) — GUARDIA de R20: el tope de puntos del SERVIDOR y el del PAQUETE DE
// GRAFICAS son el mismo numero.
//
// Por que son DOS constantes y no una, con todas las letras:
//
//   - `MAX_PUNTOS_SERIE` (`components/private/analytics/topes.ts`) es del paquete de
//     graficas de la 131: por encima de el, fuera de produccion, el paquete LANZA.
//   - `TOPE_PUNTOS_SERIE` (`lib/analytics/types.ts`) es del servidor: por encima de el,
//     el troceo pasa de `dia` a `semana` (⟨D2⟩ / R18).
//
// Unificarlas importando la de `components/` desde `lib/` seria una INVERSION DE CAPAS —un
// servicio dependiendo de un componente de presentacion— y ademas el guardia de modulo
// puro (`modulo-puro.guardia.test.ts`) ni siquiera lo permitiria. Asi que se declaran dos
// veces y la igualdad la sostiene ESTE test, que lee las dos fuentes. Es el mismo patron
// de dos-fuentes-independientes que la 127 usa con `IDS_FINANCIERAS_SERVIDAS` contra el
// catalogo.
//
// SI ESTE TEST SE PONE ROJO, cual mover:
//   - si cambio el techo de lo que el paquete de graficas sabe pintar -> manda
//     `MAX_PUNTOS_SERIE`, y `TOPE_PUNTOS_SERIE` lo sigue;
//   - si cambio la politica de agregacion del servidor -> hay que decidirlo con el
//     paquete delante, porque el 62 se justifica en `topes.ts` como «53 semanas mas
//     margen», es decir, dando por supuesta la agregacion semanal de ⟨D2⟩.
// Lo que NO es una salida es relajar este test.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const CUBO_TEMPORAL_PATH = path.join(REPO_ROOT, "lib", "analytics", "cubo-temporal.ts");

/** Quita comentarios de bloque, de linea y trailing, para censar solo el codigo. */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

/** Especificadores de modulo de todo import/export/require del codigo dado. */
function especificadoresDeImport(codigo: string): string[] {
  const especificadores: string[] = [];
  const estatico = /\b(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of codigo.matchAll(estatico)) especificadores.push(m[1]);
  const dinamico = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of codigo.matchAll(dinamico)) especificadores.push(m[1]);
  return especificadores;
}

describe("R20 · el tope del servidor y el del paquete de graficas son el mismo numero", () => {
  it("TOPE_PUNTOS_SERIE es igual a MAX_PUNTOS_SERIE", () => {
    expect(
      TOPE_PUNTOS_SERIE,
      "lib/analytics/types.ts y components/private/analytics/topes.ts declaran topes distintos: " +
        "el servidor agregaria a una granularidad que el paquete de graficas no acepta pintar",
    ).toBe(MAX_PUNTOS_SERIE);
  });

  it("las dos fuentes se leen de verdad y ninguna es undefined", () => {
    // Contrapeso: si un renombrado dejara cualquiera de las dos en `undefined`, la
    // comparacion de arriba pasaria por vacio (`undefined === undefined`).
    expect(typeof TOPE_PUNTOS_SERIE).toBe("number");
    expect(typeof MAX_PUNTOS_SERIE).toBe("number");
    expect(TOPE_PUNTOS_SERIE).toBeGreaterThan(0);
  });

  it("el tope del servidor deja caber las 53 semanas del rango maximo admisible", () => {
    // El 62 se justifica en `topes.ts` como «53 semanas mas margen»: si alguien bajase el
    // tope por debajo de 53, la agregacion semanal de un rango de 366 dias no cabria y R19
    // seria imposible de cumplir con las dos granularidades declaradas.
    expect(TOPE_PUNTOS_SERIE).toBeGreaterThanOrEqual(53);
  });
});

describe("R20 · lib/analytics/cubo-temporal.ts no importa de components/", () => {
  it("ningun especificador de import del modulo contiene el segmento components", () => {
    const codigo = soloCodigo(fs.readFileSync(CUBO_TEMPORAL_PATH, "utf8"));
    const infractores = especificadoresDeImport(codigo).filter((e) =>
      e.split("/").includes("components"),
    );
    expect(
      infractores,
      "cubo-temporal.ts importa de components/: es una inversion de capas y es justo lo " +
        "que obliga a que el tope se declare dos veces y se compare por test",
    ).toEqual([]);
  });

  it("el modulo importa el tope de @/lib/analytics/types y no escribe el numero a mano", () => {
    const codigo = soloCodigo(fs.readFileSync(CUBO_TEMPORAL_PATH, "utf8"));
    expect(codigo).toContain("TOPE_PUNTOS_SERIE");
    expect(especificadoresDeImport(codigo)).toContain("@/lib/analytics/types");
    expect(
      new RegExp(`\\b${MAX_PUNTOS_SERIE}\\b`).test(codigo),
      `cubo-temporal.ts escribe el literal ${MAX_PUNTOS_SERIE} en vez de usar TOPE_PUNTOS_SERIE`,
    ).toBe(false);
  });

  it("autocomprobacion: el censo de imports detecta lo que dice detectar", () => {
    const ejemplo = 'import { MAX_PUNTOS_SERIE } from "@/components/private/analytics/topes";';
    expect(especificadoresDeImport(ejemplo)).toEqual(["@/components/private/analytics/topes"]);
    expect(
      especificadoresDeImport(ejemplo).filter((e) => e.split("/").includes("components")),
    ).not.toEqual([]);
    // ...y no confunde un comentario que NOMBRA la ruta prohibida con un import real.
    expect(especificadoresDeImport(soloCodigo("// no importes components/private/x\n"))).toEqual([]);
  });
});
