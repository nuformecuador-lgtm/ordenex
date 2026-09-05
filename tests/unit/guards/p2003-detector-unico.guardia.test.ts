import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `"P2003"` NO SE COMPRUEBA A MANO EN NINGUN SITIO: SOLO LO NOMBRA `_shared/prisma-fk.ts`.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE. Bajo `@prisma/adapter-pg` una violacion de clave foranea **no llega con el codigo
// `P2003`**. MEDIDO contra Postgres el 2026-09-04, en tres tablas distintas (`usuario` en la
// ficha 373, `zona` y `tarifas` hoy), y siempre igual:
//
//   ctor: DriverAdapterError · code: undefined · meta: null · cause.code: "23001"
//   isKnownRequestError: false
//
// Un `catch` que decida con `e.code === "P2003"` por tanto NO ENTRA NUNCA, y el error crudo
// escapa hasta el manejador generico: el usuario ve un error interno donde tenia que leer «no
// se puede, esta en uso». Eso ya paso DOS VECES en este arbol —`TarifaRepository.hardDelete` y
// `ZonaRepository.hardDelete`, ambos con la suite en verde porque sus tests FABRICABAN el error
// en la forma que no ocurre— y por eso el detector correcto (`esViolacionDeClaveForanea`) deja
// de ser una recomendacion y pasa a ser el unico sitio del arbol autorizado a nombrar el codigo.
//
// LO QUE ESTA GUARDIA **NO** PROHIBE, y no es un olvido: `"P2002"` y `"P2025"`. Los dos SI
// conservan su codigo bajo el adapter, y tambien esta medido el 2026-09-04:
//   - unico repetido en `zona.nombre` -> `PrismaClientKnownRequestError` · code `P2002` · con
//     `meta.driverAdapterError.cause.originalCode = "23505"` (lo unico que se pierde es
//     `meta.target`, que es justo lo que arregla `_shared/prisma-unique.ts`);
//   - borrar una `tarifa` inexistente -> `PrismaClientKnownRequestError` · code `P2025`.
// Es decir: el adapter traduce esos dos y NO traduce el de la FK. Comprobarlos a mano es
// legitimo; comprobar `P2003` a mano no lo es.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

/** El unico archivo del arbol autorizado a nombrar el codigo. */
const PUNTO_UNICO = "lib/repositories/_shared/prisma-fk.ts";

/** Las carpetas que se barren: las que pueden contener codigo de servidor. */
const RAICES = ["lib", "app", "components", "hooks", "scripts"];

function archivosDe(dir: string, acc: string[] = []): string[] {
  const abs = path.join(RAIZ, dir);
  for (const entrada of readdirSync(abs)) {
    const rel = path.join(dir, entrada).replace(/\\/g, "/");
    if (statSync(path.join(RAIZ, rel)).isDirectory()) archivosDe(rel, acc);
    else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel);
  }
  return acc;
}

const ARCHIVOS = RAICES.flatMap((r) => archivosDe(r));

function fuente(rel: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rel), "utf8"));
}

/**
 * `true` si el CODIGO (ya sin comentarios) nombra el literal `P2003`. Deliberadamente cruda: no
 * intenta distinguir un `===` de un `switch` o de una constante intermedia, porque las tres
 * formas producen el mismo fallo mudo. Nombrarlo fuera del detector ya es la infraccion.
 */
export function nombraElCodigoDeFk(codigo: string): boolean {
  return /["'`]P2003["'`]/.test(codigo);
}

describe("el detector de la guardia se prueba a si mismo", () => {
  it("CONTRAPRUEBA: reconoce las formas en que se escribiria", () => {
    expect(nombraElCodigoDeFk('if (e.code === "P2003") return "referenced";')).toBe(true);
    expect(nombraElCodigoDeFk("if (e.code === 'P2003') return 'referenced';")).toBe(true);
    expect(nombraElCodigoDeFk('const FK = "P2003";')).toBe(true);
    expect(nombraElCodigoDeFk('case "P2003":')).toBe(true);
    expect(nombraElCodigoDeFk('e.code !== "P2003"')).toBe(true);
  });

  it("CONTRAPRUEBA: no se dispara con los codigos que el adapter SI traduce", () => {
    expect(nombraElCodigoDeFk('if (e.code === "P2002") return false;')).toBe(false);
    expect(nombraElCodigoDeFk('if (e.code === "P2025") return "not_found";')).toBe(false);
  });

  it("CONTRAPRUEBA: un comentario que lo EXPLICA no cuenta como infraccion", () => {
    // Es la razon de pasar por `quitarComentarios`: los comentarios de este arbol nombran a
    // proposito lo que el codigo tiene prohibido, y sin esto habria que borrar la explicacion
    // para pasar la guardia.
    const solo = quitarComentarios('// el detector NO es `e.code === "P2003"`\nreturn ok;');
    expect(nombraElCodigoDeFk(solo)).toBe(false);
  });

  it("anti-vacuidad: el barrido lee de verdad un arbol grande", () => {
    expect(ARCHIVOS.length).toBeGreaterThan(500);
    expect(ARCHIVOS).toContain(PUNTO_UNICO);
    expect(ARCHIVOS).toContain("lib/repositories/TarifaRepository.ts");
    expect(ARCHIVOS).toContain("lib/repositories/ZonaRepository.ts");
  });
});

describe("nadie compara contra `P2003` fuera de `esViolacionDeClaveForanea`", () => {
  it("el punto unico SI lo nombra (control positivo)", () => {
    // Sin esto, el barrido de abajo podria estar verde porque el detector no encuentra nada.
    expect(nombraElCodigoDeFk(fuente(PUNTO_UNICO))).toBe(true);
  });

  it("ningun OTRO archivo del arbol lo nombra", () => {
    const infractores = ARCHIVOS.filter(
      (rel) => rel !== PUNTO_UNICO && nombraElCodigoDeFk(fuente(rel)),
    );
    expect(
      infractores,
      "bajo `@prisma/adapter-pg` la violacion de FK NO trae el codigo `P2003` (llega como " +
        "`DriverAdapterError` con `cause.code === \"23001\"`), asi que ese `catch` no entra nunca " +
        "y el error crudo escapa como un 500. Usa `esViolacionDeClaveForanea` de " +
        "`lib/repositories/_shared/prisma-fk.ts`.",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: pegar la comprobacion ingenua en un repositorio pondria esto rojo", () => {
    const arreglado = fuente("lib/repositories/ZonaRepository.ts");
    expect(nombraElCodigoDeFk(arreglado)).toBe(false);
    expect(nombraElCodigoDeFk(`${arreglado}\nif (e.code === "P2003") return "referenced";`)).toBe(
      true,
    );
  });

  it("los dos que lo tuvieron usan hoy el detector compartido", () => {
    for (const rel of ["lib/repositories/TarifaRepository.ts", "lib/repositories/ZonaRepository.ts"]) {
      expect(fuente(rel), rel).toContain("esViolacionDeClaveForanea");
    }
  });
});
