import { describe, it, expect } from "vitest";
import type { MetodoPagoValue } from "@prisma/client";
import { computeTotales } from "@/lib/utils/cierre-totales";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import { conPagos, pagosDesdeEscalar } from "@/tests/fixtures/cierre-pagos";

/**
 * Feature 212 (T11) — el reparto del recaudo por método, probado con MUTACIONES.
 *
 * `computeTotales` produce los cuatro totales que se congelan en `cierre_dia`, y uno de ellos,
 * `total_efectivo`, es la `E` del `min(P, E)` con el que se le paga al mensajero (feature 44,
 * `ILiquidacionPagoRepository.ts:96,106`). Un desglose mal sumado no se ve como un número feo en
 * una pantalla: se ve como un pago de más o de menos a una persona.
 *
 * Por eso ningún caso de este archivo se conforma con «suma algo»: cada uno MUTA una pieza del
 * insumo (el método de una línea, su monto, el resultado de la gestión, la existencia de la
 * línea) y fija EXACTAMENTE qué baldes se mueven y cuáles no. Un `computeTotales` que metiera
 * todo en `efectivo`, que volviera a leer `montoRecibido`, o que ignorara el `resultado`, mata
 * al menos un caso de aquí.
 */

type Linea = CierreGestionPendienteRow["pagos"][number];

/** Gestión de cierre con el desglose que el caso quiera; el par escalar viaja al lado (R31). */
function gestion(
  gestionId: string,
  resultado: CierreGestionPendienteRow["resultado"],
  montoRecibido: string | null,
  pagos: Linea[],
  metodoPago: MetodoPagoValue | null = null,
): CierreGestionPendienteRow {
  return conPagos(
    {
      gestionId,
      ordenId: `o-${gestionId}`,
      numGuia: 1,
      numRemision: `R-${gestionId}`,
      destinatario: "Ana",
      direccion: null,
      zonaNombre: "Z",
      provinciaNombre: "P",
      cantonNombre: "C",
      distritoNombre: null,
      producto: "X",
      tiendaNombre: "T",
      resultado,
      montoRecibido,
      metodoPago,
      motivo: null,
      fechaReprogramacion: null,
      evidenciaStoragePath: null,
      pagoMensajero: null,
      ingresoBodegaRechazo: null,
      esRechazoSla: false,
      desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
      causaIncidente: null,
      indemnizacion: null,
    },
    pagos,
  );
}

/** La entrega MIXTA de referencia del design §4: ₡8.000 = 5.000 efectivo + 3.000 transferencia. */
function mixta(): CierreGestionPendienteRow {
  return gestion("mix", "entregada", "8000.00", [
    { metodo: "efectivo", monto: "5000.00" },
    { metodo: "transferencia", monto: "3000.00" },
  ]);
}

/** Copia de una gestión con OTRO desglose: el operador de mutación de estos casos. */
function conLineas(g: CierreGestionPendienteRow, pagos: Linea[]): CierreGestionPendienteRow {
  return { ...g, pagos };
}

describe("computeTotales — caso 1 (R24/R29): entrega MIXTA reparte por método", () => {
  it("5.000 efectivo + 3.000 transferencia van a SU balde, no los 8.000 a efectivo", () => {
    expect(computeTotales([mixta()])).toEqual({
      efectivo: "5000.00", // la `E` del min(P,E): SOLO la parte en efectivo (R29)
      simpe: "0.00",
      transferencia: "3000.00",
      general: "8000.00",
    });
  });

  it("el `montoRecibido` de la gestión NO se suma por su cuenta (no hay doble conteo)", () => {
    // La gestión declara 8.000 como total snapshot y el desglose suma 8.000: si el cálculo
    // mirara las dos fuentes, el general saldría 16.000.
    expect(computeTotales([mixta()]).general).toBe("8000.00");
  });
});

describe("computeTotales — caso 2 (R24): MUTACIÓN de método", () => {
  it("mover una línea de efectivo a SINPE cambia EXACTAMENTE dos baldes y deja el general", () => {
    const antes = computeTotales([mixta()]);
    const despues = computeTotales([
      conLineas(mixta(), [
        { metodo: "SINPE", monto: "5000.00" },
        { metodo: "transferencia", monto: "3000.00" },
      ]),
    ]);
    expect(despues).toEqual({
      efectivo: "0.00",
      simpe: "5000.00",
      transferencia: "3000.00",
      general: "8000.00",
    });
    expect(despues.general).toBe(antes.general);
    expect(despues.transferencia).toBe(antes.transferencia);
    expect(despues.efectivo).not.toBe(antes.efectivo);
    expect(despues.simpe).not.toBe(antes.simpe);
  });
});

describe("computeTotales — caso 3 (R24/R28): MUTACIÓN de monto en ±0.01", () => {
  it("+0.01 en la línea de efectivo mueve efectivo y general en 0.01, y nada más", () => {
    const totales = computeTotales([
      conLineas(mixta(), [
        { metodo: "efectivo", monto: "5000.01" },
        { metodo: "transferencia", monto: "3000.00" },
      ]),
    ]);
    expect(totales).toEqual({
      efectivo: "5000.01",
      simpe: "0.00",
      transferencia: "3000.00",
      general: "8000.01",
    });
  });

  it("-0.01 en la línea de transferencia mueve transferencia y general en 0.01, y nada más", () => {
    const totales = computeTotales([
      conLineas(mixta(), [
        { metodo: "efectivo", monto: "5000.00" },
        { metodo: "transferencia", monto: "2999.99" },
      ]),
    ]);
    expect(totales).toEqual({
      efectivo: "5000.00",
      simpe: "0.00",
      transferencia: "2999.99",
      general: "7999.99",
    });
  });
});

describe("computeTotales — caso 4 (R25): MUTACIÓN de resultado", () => {
  it("la MISMA gestión como `reprogramada` aporta 0.00 en los cuatro totales", () => {
    const entregada = mixta();
    const reprogramada: CierreGestionPendienteRow = { ...entregada, resultado: "reprogramada" };
    expect(computeTotales([reprogramada])).toEqual({
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
    });
    // Contraprueba de anti-vacuidad: las líneas SÍ estaban ahí, y con `entregada` sí suman.
    expect(reprogramada.pagos).toHaveLength(2);
    expect(computeTotales([entregada]).general).toBe("8000.00");
  });

  it("ninguno de los otros tres resultados aporta, aunque lleve líneas", () => {
    for (const resultado of ["devuelta", "rechazada", "incidente"] as const) {
      const g: CierreGestionPendienteRow = { ...mixta(), resultado };
      expect(computeTotales([g])).toEqual({
        efectivo: "0.00",
        simpe: "0.00",
        transferencia: "0.00",
        general: "0.00",
      });
    }
  });
});

describe("computeTotales — caso 5 (R26): BORRADO de línea", () => {
  it("quitar la línea de transferencia baja SOLO ese balde y el general, en su monto exacto", () => {
    const totales = computeTotales([
      conLineas(mixta(), [{ metodo: "efectivo", monto: "5000.00" }]),
    ]);
    // Nada «compensa» desde `montoRecibido`, que sigue declarando 8.000.00.
    expect(totales).toEqual({
      efectivo: "5000.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "5000.00",
    });
  });

  it("una `entregada` SIN ninguna línea no aporta a ningún balde", () => {
    const sinLineas = gestion("sin", "entregada", "8000.00", [], "efectivo");
    expect(sinLineas.pagos).toEqual([]);
    expect(computeTotales([sinLineas])).toEqual({
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
    });
  });
});

/**
 * El conjunto GENERADO de los casos 6 y 7: 24 gestiones deterministas con los tres métodos, los
 * cuatro resultados, entregas mixtas, entregas de un solo método y entregas sin cobro. Se
 * construye una sola vez y se mira desde dos ángulos: la invariante de suma (R28) y la paridad
 * con el modelo escalar (R27).
 */
function conjuntoGenerado(): CierreGestionPendienteRow[] {
  const metodos: MetodoPagoValue[] = ["efectivo", "SINPE", "transferencia"];
  const resultados = ["entregada", "reprogramada", "devuelta", "rechazada"] as const;
  const filas: CierreGestionPendienteRow[] = [];
  for (let i = 0; i < 12; i++) {
    const metodo = metodos[i % 3];
    const resultado = resultados[i % 4];
    // Montos con céntimos que NO son redondos: una suma en coma flotante se delataría.
    const monto = `${100 + i * 7}.${String((i * 13) % 100).padStart(2, "0")}`;
    filas.push(gestion(`g-${i}`, resultado, monto, [{ metodo, monto }], metodo));
  }
  // Entregas MIXTAS: dos y tres métodos en la misma gestión.
  filas.push(
    gestion("mix-2", "entregada", "8000.00", [
      { metodo: "efectivo", monto: "5000.00" },
      { metodo: "transferencia", monto: "3000.00" },
    ]),
  );
  filas.push(
    gestion("mix-3", "entregada", "1000.05", [
      { metodo: "efectivo", monto: "333.35" },
      { metodo: "SINPE", monto: "333.35" },
      { metodo: "transferencia", monto: "333.35" },
    ]),
  );
  // Entrega SIN cobro (R14): cero líneas, aunque el par escalar histórico dijera `efectivo`/0.
  filas.push(gestion("sin-cobro", "entregada", "0.00", [], "efectivo"));
  // Gestión no entregada CON líneas (el histórico inconsistente de la pregunta abierta 1).
  filas.push(
    gestion("rechazada-con-linea", "rechazada", "500.00", [{ metodo: "efectivo", monto: "500.00" }]),
  );
  return filas;
}

/**
 * Suma de STRINGs de escala 2 en CÉNTIMOS ENTEROS: el oráculo independiente contra el que se
 * mide `computeTotales`. Deliberadamente NO usa `Prisma.Decimal` —comparar la implementación
 * consigo misma no probaría nada— y deliberadamente NO suma flotantes: convierte cada monto a
 * un entero de céntimos (`Number` sobre trozos que son dígitos enteros, exacto) y suma enteros.
 * Es la misma técnica que el borde zod de esta feature (`lib/utils/pagos-recaudo.ts`).
 */
function sumaCentimos(montos: string[]): string {
  let centimos = 0;
  for (const m of montos) {
    const [enteros, decimales = "0"] = m.split(".");
    centimos += Number(enteros) * 100 + Number(decimales.padEnd(2, "0").slice(0, 2));
  }
  return `${Math.trunc(centimos / 100)}.${String(centimos % 100).padStart(2, "0")}`;
}

describe("computeTotales — caso 6 (R28): la invariante de suma", () => {
  const gestiones = conjuntoGenerado();
  const totales = computeTotales(gestiones);

  it("general = efectivo + SINPE + transferencia, al céntimo", () => {
    expect(totales.general).toBe(
      sumaCentimos([totales.efectivo, totales.simpe, totales.transferencia]),
    );
  });

  it("general = Σ montoRecibido de las `entregada` CON líneas, al céntimo", () => {
    const esperado = sumaCentimos(
      gestiones
        .filter((g) => g.resultado === "entregada" && g.pagos.length > 0)
        .map((g) => g.montoRecibido ?? "0.00"),
    );
    expect(totales.general).toBe(esperado);
    expect(totales.general).not.toBe("0.00"); // anti-vacuidad: el conjunto sí tiene dinero
  });

  it("cada balde es la Σ de las líneas de SU método en gestiones entregadas", () => {
    const porMetodo = (metodo: MetodoPagoValue): string =>
      sumaCentimos(
        gestiones
          .filter((g) => g.resultado === "entregada")
          .flatMap((g) => g.pagos.filter((p) => p.metodo === metodo).map((p) => p.monto)),
      );
    expect(totales.efectivo).toBe(porMetodo("efectivo"));
    expect(totales.simpe).toBe(porMetodo("SINPE"));
    expect(totales.transferencia).toBe(porMetodo("transferencia"));
  });
});

describe("computeTotales — caso 7 (R27): paridad al céntimo con el modelo escalar", () => {
  /**
   * La implementación ESCALAR previa a la 212, copiada tal cual: un `switch` sobre
   * `metodoPago` que mete `montoRecibido` entero en un solo balde. Es la referencia contra la
   * que se mide la paridad; si el cálculo nuevo se desviara un céntimo sobre datos
   * BACKFILLEADOS (una línea por gestión), este caso lo caza.
   */
  function totalesEscalares(gestiones: CierreGestionPendienteRow[]) {
    const acumulado: Record<MetodoPagoValue, string[]> = {
      efectivo: [],
      SINPE: [],
      transferencia: [],
    };
    for (const g of gestiones) {
      if (g.resultado !== "entregada" || g.montoRecibido === null || g.metodoPago === null) continue;
      acumulado[g.metodoPago].push(g.montoRecibido);
    }
    const efectivo = sumaCentimos(acumulado.efectivo);
    const simpe = sumaCentimos(acumulado.SINPE);
    const transferencia = sumaCentimos(acumulado.transferencia);
    return {
      efectivo,
      simpe,
      transferencia,
      general: sumaCentimos([efectivo, simpe, transferencia]),
    };
  }

  it("un conjunto histórico (1 línea por gestión, como el backfill) da los MISMOS 4 strings", () => {
    // Solo gestiones de método ÚNICO: es lo que existía antes de la feature y lo que el
    // backfill (R6/R7) produce. Las mixtas no tienen equivalente escalar que comparar.
    const historicas = conjuntoGenerado().filter((g) => g.pagos.length <= 1);
    const escalares = totalesEscalares(historicas);
    expect(computeTotales(historicas)).toEqual(escalares);
    expect(escalares.general).not.toBe("0.00"); // anti-vacuidad
  });

  it("la entrega SIN cobro escalar (`efectivo`/0.00) no mueve ningún total", () => {
    // El backfill excluye `monto_recibido = 0`, así que la gestión queda con CERO líneas: es
    // la equivalencia exacta con el `+0.00` que sumaba el modelo escalar.
    const sinCobro = gestion("sin-cobro", "entregada", "0.00", [], "efectivo");
    expect(pagosDesdeEscalar("0.00", "efectivo")).toEqual([]);
    expect(computeTotales([sinCobro])).toEqual(totalesEscalares([sinCobro]));
  });
});

describe("computeTotales — caso 8 (R30): exactitud decimal", () => {
  it("33.33 × 3 repartido en dos métodos da 99.99 exacto, no 99.99000000000001", () => {
    const totales = computeTotales([
      gestion("dec", "entregada", "99.99", [
        { metodo: "efectivo", monto: "33.33" },
        { metodo: "SINPE", monto: "66.66" },
      ]),
    ]);
    expect(totales).toEqual({
      efectivo: "33.33",
      simpe: "66.66",
      transferencia: "0.00",
      general: "99.99",
    });
    expect(totales.general).not.toContain("0000");
  });

  it("0.10 + 0.20 en dos líneas del MISMO método da 0.30 (la trampa clásica del float)", () => {
    const totales = computeTotales([
      gestion("g-a", "entregada", "0.10", [{ metodo: "efectivo", monto: "0.10" }]),
      gestion("g-b", "entregada", "0.20", [{ metodo: "efectivo", monto: "0.20" }]),
    ]);
    expect(totales.efectivo).toBe("0.30");
    expect(totales.general).toBe("0.30");
  });

  it("todos los totales salen como STRING de escala 2", () => {
    const totales = computeTotales([mixta()]);
    for (const valor of Object.values(totales)) {
      expect(typeof valor).toBe("string");
      expect(valor).toMatch(/^\d+\.\d{2}$/);
    }
  });
});
