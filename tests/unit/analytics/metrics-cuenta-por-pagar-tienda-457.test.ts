import { describe, it, expect } from "vitest";

import { getMetrica } from "@/lib/analytics/metrics";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";

// FICHA 457 (R52, hallazgo m1 de la revision) — la metrica `cuenta_por_pagar_tienda` DECLARA todas
// las categorias del libro de las tiendas, incluidas las dos del pago de una tienda a Ordenex.
//
// Por que hace falta: `definicion.categorias` esta tipado `readonly string[]`, asi que el compilador
// no obliga a nombrar una categoria nueva, y el repositorio suma el libro ENTERO sin filtrar por
// categoria (`CuentasPorPagarAnaliticaRepository`): quitar `abono_tienda`/`abono_tienda_anulado` de
// `lib/analytics/metrics.ts` no cambiaria ninguna cifra y ningun test de analitica se enteraba
// (mutacion H de la revision: 176/176 verdes). Pero el catalogo es lo que se describe al asistente:
// una metrica que suma una categoria que no nombra se explica mal.
//
// La fuente de verdad es el SEED del enum (`WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`, que no compila
// si el enum gana un valor que no lista), no una lista copiada aqui.

describe("457/R52 — cuenta_por_pagar_tienda declara el libro de las tiendas ENTERO", () => {
  const categorias = () => {
    const metrica = getMetrica("cuenta_por_pagar_tienda");
    if (metrica === undefined) throw new Error("el catalogo perdio cuenta_por_pagar_tienda");
    return metrica.definicion.categorias ?? [];
  };

  it("sus categorias son EXACTAMENTE las del seed del libro de las tiendas (sin faltas ni repetidas)", () => {
    expect([...categorias()].sort()).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort());
  });

  it("nombra el pago de la tienda a Ordenex y su anulacion (literal del contrato, R52)", () => {
    expect(categorias()).toContain("abono_tienda");
    expect(categorias()).toContain("abono_tienda_anulado");
  });
});
