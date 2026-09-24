import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NOMBRE_ESTADO, ORDER_STATUS_SEED } from "@/lib/types/order-status";

/**
 * FICHA 455 (T1.10 · G4, design §6.4; R1, R43, R44) — EL CATALOGO ES EL APROBADO.
 *
 * `NOMBRE_ESTADO` es la fuente unica del nombre visible. Aqui se compara contra:
 *   1. la tabla §0.1 del spec ESCRITA A MANO en este archivo (literal de contrato: si alguien cambia un
 *      nombre en el codigo, este test no lo sigue solo — memoria «Literal: contrato o polizon»);
 *   2. la primera columna de `specs/456-tooltip-estados/textos-aprobados.md`, leida del disco;
 * y se exige que no haya dos estados con el mismo nombre. El comparador se prueba contra una
 * mutacion en este mismo archivo (R44).
 */

/** requirements.md §0.1 — codigo vigente -> nombre visible, en el orden del seed. */
const TABLA_APROBADA: ReadonlyArray<readonly [string, string]> = [
  ["entregado", "Entregado"],
  ["novedad", "Novedad"],
  ["devolviendo_a_tienda", "Devolviendo a tienda"],
  ["reprogramado", "Reprogramado"],
  ["en_ruta_bodega_central", "En ruta a bodega central"],
  ["en_bodega_central", "En bodega central"],
  ["en_preparacion", "En preparación"],
  ["mensajero_recogiendo_en_bodega", "Mensajero recogiendo en la bodega"],
  ["en_ruta_bodega_satelite", "En ruta a bodega satélite"],
  ["en_reparto", "En reparto"],
  ["devolucion_a_origen_por_rechazo", "Devolución a origen por rechazo"],
  ["en_bodega_satelite", "En bodega satélite"],
  ["devuelta_a_tienda", "Devuelta a tienda"],
  ["novedad_interna", "Novedad interna"],
  ["por_devolver_a_bodega_central", "Por devolver a bodega central"],
  ["devolviendo_a_bodega_central", "Devolviendo a bodega central"],
  ["por_devolver_a_tienda", "Por devolver a tienda"],
  ["por_recolectar_en_tienda", "Por recolectar en tienda"],
  ["incidente", "Incidente"],
  ["recolectando", "Recolectando"],
];

const RAIZ = path.resolve(__dirname, "..", "..", "..");

/** Los nombres de la primera columna de la tabla aprobada de la 456 (sin la cabecera ni el separador). */
function nombresDeTextosAprobados(): string[] {
  const md = readFileSync(path.join(RAIZ, "specs", "456-tooltip-estados", "textos-aprobados.md"), "utf8");
  const tabla = md.slice(0, md.indexOf("## Validado contra el código"));
  return tabla
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| Estado") && !l.startsWith("|---"))
    .map((l) => l.split("|")[1].trim());
}

/** Diferencias entre un catalogo `codigo -> nombre` y la tabla aprobada. Vacio = coinciden. */
export function diferenciasConLaTabla(catalogo: Readonly<Record<string, string>>): string[] {
  const dif: string[] = [];
  const codigos = Object.keys(catalogo);
  if (codigos.length !== TABLA_APROBADA.length) dif.push(`hay ${codigos.length} estados y la tabla tiene ${TABLA_APROBADA.length}`);
  for (const [codigo, nombre] of TABLA_APROBADA) {
    if (catalogo[codigo] !== nombre) dif.push(`${codigo}: «${catalogo[codigo]}» en vez de «${nombre}»`);
  }
  const nombres = Object.values(catalogo);
  for (const n of new Set(nombres)) {
    if (nombres.filter((x) => x === n).length > 1) dif.push(`«${n}» lo comparten dos estados`);
  }
  return dif;
}

describe("455/R1 · R43 (G4) — el catalogo de nombres es el aprobado", () => {
  it("20 codigos, un nombre cada uno, igual a la tabla aprobada (§0.1)", () => {
    expect(diferenciasConLaTabla(NOMBRE_ESTADO)).toEqual([]);
  });

  it("las claves de NOMBRE_ESTADO son exactamente ORDER_STATUS_SEED, en su orden", () => {
    expect(Object.keys(NOMBRE_ESTADO)).toEqual([...ORDER_STATUS_SEED]);
    expect(TABLA_APROBADA.map(([c]) => c)).toEqual([...ORDER_STATUS_SEED]);
  });

  it("los 20 nombres son los de `specs/456-tooltip-estados/textos-aprobados.md` (leidos del disco)", () => {
    const aprobados = nombresDeTextosAprobados();
    expect(aprobados).toHaveLength(20);
    expect(new Set(Object.values(NOMBRE_ESTADO))).toEqual(new Set(aprobados));
  });

  it("MUTACION (R44): un nombre cambiado, uno repetido o uno de menos ponen rojo el comparador", () => {
    expect(diferenciasConLaTabla({ ...NOMBRE_ESTADO, entregado: "Entregada" })).toEqual([
      "entregado: «Entregada» en vez de «Entregado»",
    ]);
    expect(diferenciasConLaTabla({ ...NOMBRE_ESTADO, novedad_interna: "Novedad" })).toEqual([
      "novedad_interna: «Novedad» en vez de «Novedad interna»",
      "«Novedad» lo comparten dos estados",
    ]);
    const { incidente: _fuera, ...sinUno } = NOMBRE_ESTADO;
    void _fuera;
    expect(diferenciasConLaTabla(sinUno)).toEqual([
      "hay 19 estados y la tabla tiene 20",
      "incidente: «undefined» en vez de «Incidente»",
    ]);
  });
});
