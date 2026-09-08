import { describe, it, expect } from "vitest";

import {
  CATEGORIA_TIENDA_LABEL,
  DESGLOSE_MI_WALLET_AVISO,
  DESGLOSE_MI_WALLET_LABEL,
} from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";

// ⭑ FICHA 381 (T I.3, R37) — LA ACLARACIÓN DEL IMPORTE DE «CARGOS» EN LA WALLET DE LA TIENDA.
//
// Es la ÚNICA línea de producción de la tanda I, y existe por una razón concreta: hasta esta
// ficha, todo lo que caía dentro de «Cargos de Ordenex» lo emitía la máquina —fletes, comisión
// e IVA, derivados de una tarifa—, así que la aclaración podía enumerarlos y ser completa.
// Desde esta ficha, ahí dentro puede haber un cobro que decidió una persona. Una enumeración
// que siguiera nombrando sólo los conceptos automáticos le diría a la tienda que ese importe es
// de fletes cuando ya no lo es, y le escondería justo la parte que puede querer discutir.
//
// El resto del archivo NO se toca: los tres rótulos, sus otras dos aclaraciones y el aviso
// compuesto siguen igual, y aquí se afirma que siguen igual.

describe("⭑ FICHA 381 (R37) — la aclaración de «Cargos de Ordenex» nombra los cobros", () => {
  it("dice qué hay dentro del importe, incluidos los cobros", () => {
    // Literal, y ES el contrato: es la frase que la tienda lee bajo la cifra.
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toBe("Fletes, comisión, IVA y cobros de Ordenex");
  });

  it("ya no enumera SÓLO los conceptos automáticos", () => {
    const pista = DESGLOSE_MI_WALLET_LABEL.cargosHint;
    // La enumeración de la 172 —«Fletes, comisión e IVA»— era completa y dejó de serlo.
    expect(pista).not.toBe("Fletes, comisión e IVA");
    expect(pista).toMatch(/cobro/i);
    // …y sigue nombrando los tres automáticos: R37 pide AÑADIR, no sustituir. Sin esto, un
    // «Cobros» a secas —que perdería los fletes— pasaría el caso anterior.
    expect(pista).toMatch(/flete/i);
    expect(pista).toMatch(/comisión/i);
    expect(pista).toMatch(/IVA/);
  });

  it("usa la MISMA palabra con la que el cobro se rotula en el libro de la tienda", () => {
    // La tienda ve la cifra agregada arriba y, más abajo, una fila «Cobro de Ordenex». Que la
    // aclaración use esa palabra es lo que permite relacionar las dos sin adivinar.
    expect(CATEGORIA_TIENDA_LABEL.cobro_manual).toBe("Cobro de Ordenex");
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint.toLowerCase()).toContain("cobros de ordenex");
  });

  it("no promete ninguna comprobación de saldo ni habla de deuda impagable", () => {
    // R27: un cobro NO se compara contra ningún disponible, y el saldo puede quedar negativo.
    // La aclaración no puede sugerir lo contrario.
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).not.toMatch(/insuficiente|suficiente|deuda/i);
  });
});

describe("FICHA 381 — lo que NO cambia de la cabecera de /mi-wallet (R11 en espíritu)", () => {
  it("los tres rótulos y sus otras dos aclaraciones siguen byte a byte", () => {
    expect(DESGLOSE_MI_WALLET_LABEL.aFavor).toBe("A tu favor");
    expect(DESGLOSE_MI_WALLET_LABEL.aFavorHint).toBe("COD recaudado y ajustes");
    expect(DESGLOSE_MI_WALLET_LABEL.cargos).toBe("Cargos de Ordenex");
    expect(DESGLOSE_MI_WALLET_LABEL.pagado).toBe("Ya pagado");
    expect(DESGLOSE_MI_WALLET_LABEL.pagadoHint).toBe("Lo que Ordenex ya te entregó");
    expect(DESGLOSE_MI_WALLET_LABEL.saldo).toBe("Saldo a favor");
  });

  it("las claves de la cabecera siguen siendo las siete, en el orden de la fórmula", () => {
    expect(Object.keys(DESGLOSE_MI_WALLET_LABEL)).toEqual([
      "aFavor",
      "aFavorHint",
      "cargos",
      "cargosHint",
      "pagado",
      "pagadoHint",
      "saldo",
    ]);
  });

  it("el aviso compuesto sigue construyéndose con los rótulos REALES y sigue siendo coherente", () => {
    // Se compone de `pagado`, `aFavor` y `saldo`: cambiar `cargosHint` no puede haberlo tocado,
    // y si alguien renombra un importe el aviso lo sigue en vez de nombrar una cifra que ya no
    // se llama así.
    expect(DESGLOSE_MI_WALLET_AVISO).toContain(`«${DESGLOSE_MI_WALLET_LABEL.pagado}»`);
    expect(DESGLOSE_MI_WALLET_AVISO).toContain(`«${DESGLOSE_MI_WALLET_LABEL.aFavor}»`);
    expect(DESGLOSE_MI_WALLET_AVISO).toContain(`«${DESGLOSE_MI_WALLET_LABEL.saldo}»`);
    // Y el aviso habla de los pagos ANULADOS, no de los cargos: la línea que cambió no se le
    // ha colado dentro.
    expect(DESGLOSE_MI_WALLET_AVISO).toMatch(/anularon/);
    expect(DESGLOSE_MI_WALLET_AVISO).not.toContain(DESGLOSE_MI_WALLET_LABEL.cargosHint);
  });
});
