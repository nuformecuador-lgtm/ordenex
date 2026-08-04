import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { claveDeAlcance } from "@/lib/analytics/cache-clave";
import type { AlcanceDatos } from "@/lib/analytics/alcance";

// Feature 128 / T3.2 — GUARDIA DE R6: la clave de cache nombra las CUATRO variantes de
// `AlcanceDatos`.
//
// ⚠ ESTE GUARDIA **SOBREVIVE AL MERGE**. No mide el diff contra `dev`: lee el dominio cerrado
// de `AlcanceDatos` (`lib/analytics/alcance.ts:65-69`) y comprueba que la clave lo cubre
// entero. Si mañana alguien añade una QUINTA variante de alcance y la clave no la contempla,
// este guardia se pone rojo **ANTES de que la fuga exista**.
//
// POR QUE ES UN REQUISITO DE PRIMERA CLASE Y NO UNA OPTIMIZACION. Una clave que no distingue
// el alcance no da una cifra equivocada: **filtra datos entre roles**. Un `adminSatelite` de
// la zona Z y un `admin` global cuyo filtro recortado coincida textualmente recibirian la
// MISMA entrada, y el segundo actor veria las filas del primero. Es la frontera multi-tenant
// de la 122 (`whereRollup`) saltada por la puerta de la cache.
//
// El guardia es ESTATICO a proposito. Un test dinamico solo puede comprobar las variantes que
// existen hoy; la lectura del `switch` comprueba que el AUTOR de la quinta variante se entere.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const fuenteAlcance = fs.readFileSync(
  path.join(REPO_ROOT, "lib", "analytics", "alcance.ts"),
  "utf8",
);
const fuenteClave = fs.readFileSync(
  path.join(REPO_ROOT, "lib", "analytics", "cache-clave.ts"),
  "utf8",
);

/**
 * Las variantes DECLARADAS en `lib/analytics/alcance.ts`, leidas del propio tipo. No se copian
 * aqui: copiarlas convertiria el guardia en una segunda lista que envejece sola.
 */
function variantesDeclaradas(): string[] {
  const bloque = /export type AlcanceDatos =([\s\S]*?);\n/.exec(fuenteAlcance);
  expect(bloque, "no se pudo localizar `export type AlcanceDatos` en lib/analytics/alcance.ts")
    .not.toBeNull();
  return [...bloque![1].matchAll(/tipo:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("R6 · la clave de cache nombra las cuatro variantes de `AlcanceDatos`", () => {
  it("el dominio de alcance sigue teniendo exactamente cuatro variantes", () => {
    // Si esto cambia, lo de abajo tambien tiene que cambiar: ese es el punto.
    expect(variantesDeclaradas()).toEqual(["global", "zona", "tienda", "mensajero"]);
  });

  it("`lib/analytics/cache-clave.ts` tiene un `case` por cada variante declarada", () => {
    const sinCubrir = variantesDeclaradas().filter(
      (v) => !new RegExp(`case\\s+"${v}"\\s*:`).test(fuenteClave),
    );
    expect(
      sinCubrir,
      "la clave de cache DEBE distinguir el alcance resuelto: una clave que no lo hace filtra " +
        "datos entre roles (un mensajero recibiria lo cacheado para un admin). Variantes de " +
        "`AlcanceDatos` sin `case` en `lib/analytics/cache-clave.ts`: " +
        sinCubrir.join(", "),
    ).toEqual([]);
  });

  it("y no hay rama `default` que conceda una clave comodin", () => {
    // Un `default` haria compilar la quinta variante y le daria una clave silenciosamente
    // compartida con otra. Sin `default`, TypeScript es la segunda red debajo de este guardia.
    const bloque = /export function claveDeAlcance[\s\S]*?\n}/.exec(fuenteClave);
    expect(bloque).not.toBeNull();
    expect(bloque![0]).not.toMatch(/\bdefault\s*:/);
  });

  it("cada variante produce una clave DISTINTA, y el id entra en ella", () => {
    const alcances: AlcanceDatos[] = [
      { tipo: "global" },
      { tipo: "zona", zonaId: "id-1" },
      { tipo: "tienda", tiendaId: "id-1" },
      { tipo: "mensajero", mensajeroId: "id-1" },
    ];
    const claves = alcances.map(claveDeAlcance);
    // Mismo id en las tres acotadas: si el `tipo` no entrara, colapsarian entre si.
    expect(new Set(claves).size).toBe(alcances.length);
    // Y dos ids distintos del mismo tipo tampoco comparten.
    expect(claveDeAlcance({ tipo: "zona", zonaId: "z1" })).not.toBe(
      claveDeAlcance({ tipo: "zona", zonaId: "z2" }),
    );
  });
});
