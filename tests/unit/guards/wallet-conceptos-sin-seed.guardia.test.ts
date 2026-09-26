import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { archivosDeLaWallet, codigo } from "./_wallet-458-archivos";

// =================================================================================================
// GUARDIA — FICHA 458-A (TA.3, R95 + R13/R14, R99) — LOS FILTROS DE CONCEPTO NO SALEN DEL SEED
// =================================================================================================
//
// Hasta la 458-A los tres filtros de concepto (`/wallet`, el desglose de una tienda y `/mi-wallet`)
// se poblaban del catálogo COMPLETO: `CATEGORIA_OPTIONS`, `CATEGORIA_TIENDA_OPTIONS` y
// `CATEGORIA_MI_WALLET_OPTIONS` eran `…_CATEGORIA_SEED.map(…)`. Ofrecían conceptos sin un solo
// movimiento («Otro gasto de Ordenex», que nadie produce) y no decían cuántos había (C3.1). Ahora
// los tres leen del servidor los conceptos CON movimientos (`useConceptosConMovimientos` +
// `opcionesDeConceptos`). El gate falla si en alguna superficie de la wallet (censo POR CARPETA):
//
//  1. vuelve a aparecer un catálogo de categorías (`…CATEGORIA_SEED`) —lo único que se hace con él
//     en una pantalla es poblar un filtro o una lista, y la del filtro está prohibida—; o
//  2. alguno de los tres filtros deja de construir sus opciones con `opcionesDeConceptos` sobre la
//     lectura `useConceptosConMovimientos` (control POSITIVO: no basta con que falte el SEED).
//
// Contraprueba: la fuente de antes (`CATEGORIA_OPTIONS` sobre el SEED) la pone roja.

const SEED_DE_CATEGORIAS = /\b[A-Z_]*CATEGORIA_SEED\b/g;

/** Los tres filtros de concepto de la wallet y el libro que cada uno pide. */
const FILTROS: Record<string, string> = {
  "app/(app)/wallet/_components/WalletFiltros.tsx": 'libro: "caja"',
  "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx": 'libro: "tienda"',
  "app/(app)/mi-wallet/_components/MiWalletFiltros.tsx": 'libro: "mi_tienda"',
};

export function usosDelSeed(fuente: string): string[] {
  return [...fuente.matchAll(SEED_DE_CATEGORIAS)].map((m) => m[0]);
}

describe("458-A R95 — ningún filtro de concepto de la wallet se puebla del catálogo completo", () => {
  it("no-vacuidad: los tres filtros están en el censo de la wallet", () => {
    expect(archivosDeLaWallet()).toEqual(expect.arrayContaining(Object.keys(FILTROS)));
  });

  it("ninguna superficie de la wallet usa un catálogo de categorías (`…CATEGORIA_SEED`)", () => {
    const rojos = archivosDeLaWallet()
      .map((r) => ({ archivo: r, usos: usosDelSeed(codigo(r)) }))
      .filter((h) => h.usos.length > 0);
    expect(rojos).toEqual([]);
  });

  it.each(Object.entries(FILTROS))("%s: sus opciones salen de los conceptos con movimientos", (archivo, libro) => {
    const fuente = codigo(archivo);
    expect(fuente).toContain("useConceptosConMovimientos(");
    expect(fuente).toContain(libro);
    expect(fuente).toMatch(/opcionesDeConceptos\(\s*conceptos\.conceptos,/);
    expect(fuente).not.toMatch(/CATEGORIA_\w*OPTIONS\b/);
  });

  it("contraprueba: la fuente de antes de la 458-A la pone roja", () => {
    const antes = quitarComentarios(`
      import { WALLET_MOVIMIENTO_CATEGORIA_SEED, WALLET_MOVIMIENTO_TIPO_SEED } from "@/lib/types/wallet";
      export const CATEGORIA_OPTIONS = [
        { value: "", label: "Todas las categorías" },
        ...WALLET_MOVIMIENTO_CATEGORIA_SEED.map((categoria) => ({ value: categoria, label: CATEGORIA_LABEL[categoria] })),
      ];
      export const CATEGORIA_TIENDA_OPTIONS = WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.map((c) => c);
    `);
    expect(usosDelSeed(antes)).toEqual([
      "WALLET_MOVIMIENTO_CATEGORIA_SEED",
      "WALLET_MOVIMIENTO_CATEGORIA_SEED",
      "WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED",
    ]);
    // El catálogo de TIPOS (entrada/salida) no es un filtro de concepto: no se confunde.
    expect(usosDelSeed("WALLET_MOVIMIENTO_TIPO_SEED.map((t) => t)")).toEqual([]);
    // Y el filtro de antes no pasa el control positivo.
    expect('options={CATEGORIA_OPTIONS}').not.toMatch(/opcionesDeConceptos\(\s*conceptos\.conceptos,/);
  });
});
