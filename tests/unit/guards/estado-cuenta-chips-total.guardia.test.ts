import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";

import { WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import { PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-mensajero";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";
import {
  CHIP_POR_CATEGORIA_MENSAJERO,
  CHIP_POR_CATEGORIA_TIENDA,
  CHIPS_MENSAJERO,
  CHIPS_TIENDA,
} from "@/lib/utils/estado-cuenta-chips";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.6 — GUARDIA R98 (y R24): el diccionario de chips del estado de cuenta es TOTAL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE CAZA: un par (categoria, origen[, premio]) de un libro de cuenta que no cae en EXACTAMENTE un chip
// —un chip de mas o ninguno— o un diccionario que deja de ser un `Record` sobre el catalogo completo.
// Si una categoria nueva del libro no tuviera chip, su fila desapareceria de TODOS los filtros salvo
// «Todo», y nadie lo veria.
//
// COMO: recorre el producto cartesiano de los seeds (categoria × origen × premio) y exige un chip
// conocido; y lee la FUENTE para exigir que los dos diccionarios esten tipados como `Record<…Categoria,`.
// CONTRAPRUEBA: el mismo detector sobre un diccionario MUTADO en memoria (una categoria sin funcion, un
// chip inventado) tiene que devolver problemas. CONTROL DE NO-VACUIDAD: el producto recorrido no es vacio.

const RAIZ = path.resolve(__dirname, "../../..");
const FUENTE = "lib/utils/estado-cuenta-chips.ts";

type Diccionario = Record<string, (origen: never, esPremio: never) => string>;

function problemas(
  dic: Diccionario,
  categorias: readonly string[],
  chips: readonly string[],
  conPremio: boolean,
): { problemas: string[]; recorridos: number } {
  const salida: string[] = [];
  let recorridos = 0;
  for (const categoria of categorias) {
    const fn = dic[categoria];
    if (typeof fn !== "function") {
      salida.push(`${categoria}: sin chip`);
      continue;
    }
    for (const origen of WALLET_ORIGEN_TIPO_SEED) {
      for (const esPremio of conPremio ? [false, true] : [false]) {
        recorridos += 1;
        const chip = (fn as (o: string, p: boolean) => string)(origen, esPremio);
        if (!chips.includes(chip)) salida.push(`${categoria}|${origen}|${esPremio}: chip desconocido «${chip}»`);
      }
    }
  }
  for (const clave of Object.keys(dic)) {
    if (!categorias.includes(clave)) salida.push(`${clave}: no es una categoria del libro`);
  }
  return { problemas: salida, recorridos };
}

describe("458-B — guardia estado-cuenta-chips-total (R24/R98/R99)", () => {
  it("libro de la TIENDA: cada (categoria, origen) cae en exactamente un chip conocido", () => {
    const r = problemas(CHIP_POR_CATEGORIA_TIENDA as unknown as Diccionario, WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED, CHIPS_TIENDA, false);
    expect(r.problemas).toEqual([]);
    expect(r.recorridos).toBe(WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.length * WALLET_ORIGEN_TIPO_SEED.length);
    expect(r.recorridos).toBeGreaterThan(0);
  });

  it("libro del MENSAJERO: cada (categoria, origen, premio) cae en exactamente un chip conocido", () => {
    const r = problemas(CHIP_POR_CATEGORIA_MENSAJERO as unknown as Diccionario, PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED, CHIPS_MENSAJERO, true);
    expect(r.problemas).toEqual([]);
    expect(r.recorridos).toBe(PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED.length * WALLET_ORIGEN_TIPO_SEED.length * 2);
  });

  it("los dos diccionarios son `Record` TOTALES sobre el catalogo en la fuente (un `Partial` o un `Record<string` no pasan)", () => {
    const codigo = codigoSinComentarios(FUENTE);
    expect(codigo).toMatch(/CHIP_POR_CATEGORIA_TIENDA:\s*Record<\s*WalletTiendaMovimientoCategoria,/);
    expect(codigo).toMatch(/CHIP_POR_CATEGORIA_MENSAJERO:\s*Record<\s*PagoMensajeroMovimientoCategoria,/);
    expect(codigo).not.toMatch(/Partial<\s*Record/);
    expect(readFileSync(path.join(RAIZ, FUENTE), "utf8").length).toBeGreaterThan(0);
  });

  it("CONTRAPRUEBA: una categoria sin chip, un chip inventado o una clave de mas se detectan", () => {
    const { flete: _sinFlete, ...sinUna } = CHIP_POR_CATEGORIA_TIENDA;
    void _sinFlete;
    expect(problemas(sinUna as unknown as Diccionario, WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED, CHIPS_TIENDA, false).problemas).toContain(
      "flete: sin chip",
    );
    const inventado = { ...CHIP_POR_CATEGORIA_TIENDA, cobro_manual: () => "ajustes" };
    expect(
      problemas(inventado as unknown as Diccionario, WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED, CHIPS_TIENDA, false).problemas.some((p) =>
        p.startsWith("cobro_manual|"),
      ),
    ).toBe(true);
    const deMas = { ...CHIP_POR_CATEGORIA_TIENDA, categoria_fantasma: () => "cierres" };
    expect(problemas(deMas as unknown as Diccionario, WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED, CHIPS_TIENDA, false).problemas).toContain(
      "categoria_fantasma: no es una categoria del libro",
    );
  });
});
