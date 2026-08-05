import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Fix «tope de negocio de la indemnizacion» (2026-08-04) — GUARD ESTRUCTURAL de los dos
// APROBADORES del monto.
//
// Hermano de `egreso-indemnizacion-emisores.test.ts`, que vigila quien EMITE el movimiento.
// Este vigila lo otro: quien AUTORIZA la cifra antes de que se emita. Son los mismos dos
// caminos del dinero (`IWalletIndemnizacionIncidenteFeedService.ts` los declara «los unicos
// dos»), vistos un paso antes.
//
// Por que estructural y no de comportamiento: los tests de comportamiento de cada emisor prueban
// que HOY el tope se aplica. Lo que no pueden probar es que manana no aparezca un TERCER sitio
// que apruebe un monto sin pasar por el, o que alguien borre la llamada de uno de los dos
// «porque los tests del otro siguen verdes». La comparacion es de IGUALDAD: un aprobador nuevo
// —o uno declarado que deje de aplicar el tope— pone este archivo en rojo.

const LIB_DIR = path.join(__dirname, "..", "..", "..", "lib");
const APP_DIR = path.join(__dirname, "..", "..", "..", "app");

/** APLICAR EL TOPE = invocar el helper. Nombrarlo en un comentario o importarlo no basta. */
const RE_APLICA = /excesoIndemnizacion\s*\(/;

/** El unico modulo donde la REGLA vive. No es un aprobador: es la regla que los dos consultan. */
const MODULO_REGLA = "utils/tope-indemnizacion.ts";

/** Los DOS aprobadores del monto, con su camino. */
const APROBADORES_DECLARADOS: Array<{ archivo: string; camino: string }> = [
  {
    archivo: "services/CierresAdminService.ts",
    camino:
      "aprobacion del CIERRE del mensajero (158/T1.14, R22/R26): acota cada monto capturado " +
      "contra el valor de la orden de SU gestion, antes de abrir la tx de aprobacion",
  },
  {
    archivo: "services/IncidenteAdminService.ts",
    camino:
      "aprobacion del INCIDENTE del admin (158/R52): acota el monto contra el valor de la orden " +
      "incidentada. ES EL CAMINO QUE SE USO EN PRODUCCION el 2026-08-04",
  },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(full));
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Archivos de `base` que APLICAN el tope, por ruta relativa POSIX (sin el modulo de la regla). */
function aplicadoresEn(base: string): string[] {
  return tsFiles(base)
    .filter((f) => RE_APLICA.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(base, f).replace(/\\/g, "/"))
    .filter((f) => f !== MODULO_REGLA) // la regla se define ahi; definirla no es aplicarla
    .sort();
}

describe("tope de indemnizacion — quien lo aplica", () => {
  it("la REGLA vive en UN solo modulo (no reimplementada en cada emisor)", () => {
    const full = path.join(LIB_DIR, ...MODULO_REGLA.split("/"));
    expect(fs.existsSync(full), `${MODULO_REGLA} no existe`).toBe(true);
    const fuente = fs.readFileSync(full, "utf8");
    expect(fuente).toMatch(/export function excesoIndemnizacion/);
  });

  it("los UNICOS modulos de lib/ que lo aplican son los DOS aprobadores declarados", () => {
    // IGUALDAD, no `some()`: un tercer sitio que apruebe montos —o uno de los dos que deje de
    // aplicarlo— rompe. Esa es toda la fuerza del guard.
    expect(aplicadoresEn(LIB_DIR)).toEqual(APROBADORES_DECLARADOS.map((e) => e.archivo).sort());
  });

  it("son EXACTAMENTE DOS, uno por camino del dinero", () => {
    // El mismo DOS que fija `egreso-indemnizacion-emisores.test.ts` para los emisores del
    // movimiento: si un dia hubiera tres emisores y solo dos aprobadores, el tercero cobraria
    // sin tope y los dos guards juntos lo delatarian.
    expect(APROBADORES_DECLARADOS).toHaveLength(2);
    expect(APROBADORES_DECLARADOS.map((e) => e.archivo)).toEqual([
      "services/CierresAdminService.ts", // camino del MENSAJERO (cierre)
      "services/IncidenteAdminService.ts", // camino del ADMIN (incidente)
    ]);
  });

  it("cada aprobador declarado EXISTE y de verdad lo aplica (la lista no es decorativa)", () => {
    for (const { archivo } of APROBADORES_DECLARADOS) {
      const full = path.join(LIB_DIR, ...archivo.split("/"));
      expect(fs.existsSync(full), `${archivo} no existe`).toBe(true);
      expect(RE_APLICA.test(fs.readFileSync(full, "utf8")), `${archivo} NO aplica el tope`).toBe(
        true,
      );
    }
  });

  it("NINGUN modulo de app/ lo aplica: el tope es del servidor, no de la UI", () => {
    // Una comprobacion en el cliente es una cortesia; la que cuenta es la que no se puede
    // saltar con una peticion a mano.
    expect(aplicadoresEn(APP_DIR)).toEqual([]);
  });

  it("el tope TECNICO sigue en pie y se deriva de la columna, no de un numero a ojo", () => {
    // El fix ANADE el de negocio; no puede haber quitado el que evita el `numeric field overflow`.
    const tipos = fs.readFileSync(path.join(LIB_DIR, "types", "cierres-admin.ts"), "utf8");
    expect(tipos).toMatch(/INDEMNIZACION_DIGITOS_ENTEROS = 10/);
    expect(tipos).toMatch(/export const INDEMNIZACION_MONTO_MAX/);
    const regla = fs.readFileSync(path.join(LIB_DIR, ...MODULO_REGLA.split("/")), "utf8");
    expect(regla).toMatch(/INDEMNIZACION_MONTO_MAX/);
  });

  it("el guard DISCRIMINA: nombrar el helper en prosa no cuenta como aplicarlo", () => {
    expect(RE_APLICA.test("// el tope lo aplica excesoIndemnizacion")).toBe(false);
    expect(RE_APLICA.test("import { excesoIndemnizacion } from '@/lib/utils/x';")).toBe(false);
    expect(RE_APLICA.test("const e = excesoIndemnizacion(monto, valor);")).toBe(true);
  });
});
