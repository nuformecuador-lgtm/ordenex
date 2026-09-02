import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import {
  CRITERIO_COD_RECAUDADO,
  CRITERIO_DE_APORTE,
  satisfaceCriterio,
} from "@/lib/utils/aporte-por-orden";
import { CRITERIO_RECAUDO_ENTREGA } from "@/lib/utils/dinero-por-producto";
import { WALLET_INGRESO_CONCEPTO_SEED } from "@/lib/types/wallet";

/**
 * Ficha 344 (T1.4, R18) — LA PIEZA CLAVE DE LA FICHA.
 *
 * El criterio «esta orden aporta a este concepto» vive en DOS formas —el `WHERE` que pagina y
 * cuenta, y el predicado en memoria— porque no hay manera de tener paginacion en la base (R21) y
 * total contado por la base (R28) con una sola. Lo UNICO que impide que esas dos formas
 * diverjan de la formula que produce el dinero es este archivo: compara `CRITERIO_DE_APORTE`
 * contra `derivarIngresoOrden` en TODAS las combinaciones de sus entradas.
 *
 * Si manana alguien cambia la formula —como hizo la ficha 301 al sacar `devuelta` de los
 * conceptos de devolucion— este test se pone rojo EN EL MISMO COMMIT y obliga a mover la tabla.
 *
 * MUTACION EJECUTADA Y REVERTIDA (T1.4): quitar `"rechazada"` de los `resultados` de
 * `ingreso_flete_devolucion` pone rojo el caso, nombrando la celda. Salida real en
 * `progress/impl_344.md`.
 */

const RESULTADOS: readonly GestionResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

/**
 * Una tarifa con TODOS sus valores POSITIVOS, y es una condicion del test, no un detalle: con un
 * flete de 0,00 o un IVA del 0 % un concepto DEFINIDO valdria 0,00, y la equivalencia
 * «satisface el criterio ⟺ aporta algo» dejaria de ser exacta. Ese hueco esta declarado en el
 * docstring de `CRITERIO_DE_APORTE` y su degradacion es benigna (se ensena una fila en 0,00).
 */
const TARIFA: TarifaVigente = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/** El COD de una orden que si tiene algo que recaudar. */
const CON_COD = "10000.00";

function derivar(
  concepto: (typeof WALLET_INGRESO_CONCEPTO_SEED)[number],
  hechos: {
    resultado: GestionResultado;
    cobraComision: boolean;
    tarifa: TarifaVigente | null;
    montoCobrar: string | null;
  },
): Prisma.Decimal | undefined {
  return derivarIngresoOrden(
    {
      resultado: hechos.resultado,
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: hechos.montoCobrar,
      cobraComision: hechos.cobraComision,
    },
    hechos.tarifa,
  )[concepto];
}

function satisface(
  concepto: (typeof WALLET_INGRESO_CONCEPTO_SEED)[number],
  hechos: {
    resultado: GestionResultado;
    cobraComision: boolean;
    tarifa: TarifaVigente | null;
    montoCobrar: string | null;
  },
): boolean {
  return satisfaceCriterio(CRITERIO_DE_APORTE[concepto], {
    resultado: hechos.resultado,
    cobraComision: hechos.cobraComision,
    hayTarifa: hechos.tarifa !== null,
    // Asi es como el `WHERE` lo lee: `monto_cobrar > 0` deja fuera tambien el NULL.
    hayMontoCobrar: hechos.montoCobrar !== null && new Prisma.Decimal(hechos.montoCobrar).gt(0),
    hayMontoRecibido: false,
  });
}

describe("ficha 344 — el criterio de aporte y la formula no pueden divergir (R18)", () => {
  it("el criterio coincide con la derivacion en las 120 combinaciones", () => {
    // 6 conceptos x 5 resultados x 2 `cobra_comision` x 2 «hay tarifa» = 120 celdas, con el COD
    // presente. Ahi «satisface el criterio» tiene que ser EXACTAMENTE «el concepto quedo
    // definido en la derivacion»: la supresion de ceros no interviene.
    let celdas = 0;
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      for (const resultado of RESULTADOS) {
        for (const cobraComision of [true, false]) {
          for (const tarifa of [TARIFA, null]) {
            const hechos = { resultado, cobraComision, tarifa, montoCobrar: CON_COD };
            const definido = derivar(concepto, hechos) !== undefined;
            expect(
              satisface(concepto, hechos),
              `celda ${concepto} / ${resultado} / cobraComision=${cobraComision} / tarifa=${tarifa !== null}`,
            ).toBe(definido);
            celdas += 1;
          }
        }
      }
    }
    // Se afirma el numero de casos para que un bucle vacio no pase por verde.
    expect(celdas, "no se ejecutaron las 120 celdas").toBe(120);
  });

  it("con el COD en cero o ausente, el criterio deja fuera exactamente los aportes de 0,00", () => {
    // Las MISMAS 120 combinaciones por cada forma de «no hay COD» (0,00 y NULL): ahi la
    // equivalencia que se afirma es la que decidio el humano (Q2) — «satisface» significa
    // «aporta un importe MAYOR QUE CERO».
    let celdas = 0;
    let suprimidas = 0;
    for (const montoCobrar of ["0.00", null]) {
      for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
        for (const resultado of RESULTADOS) {
          for (const cobraComision of [true, false]) {
            for (const tarifa of [TARIFA, null]) {
              const hechos = { resultado, cobraComision, tarifa, montoCobrar };
              const aporte = derivar(concepto, hechos);
              const aportaAlgo = aporte !== undefined && aporte.gt(0);
              expect(
                satisface(concepto, hechos),
                `celda ${concepto} / ${resultado} / cobraComision=${cobraComision} / tarifa=${tarifa !== null} / montoCobrar=${montoCobrar}`,
              ).toBe(aportaAlgo);
              if (aporte !== undefined && !aportaAlgo) suprimidas += 1;
              celdas += 1;
            }
          }
        }
      }
    }
    expect(celdas, "no se ejecutaron las 240 celdas del eje del COD").toBe(240);
    // NO-VACUIDAD: la supresion tiene algo que suprimir. Son la comision y su IVA de una entrega
    // con tarifa y `cobra_comision` — 2 conceptos x 1 resultado x 1 x 1, por 2 formas de «sin
    // COD» = 4 celdas. Sin esta cuenta, el caso pasaria aunque nunca hubiera un 0,00.
    expect(suprimidas, "no hubo ni un aporte de 0,00 que suprimir: el caso no probaria nada").toBe(4);
  });

  it("el criterio NO depende de la zona ni del pacto especial del distrito", () => {
    // `es_central` y `es_zona_especial` eligen la COLUMNA del flete, no si el concepto existe.
    // Si un dia lo hicieran, este caso cae y la tabla tendria que ganar un hecho.
    let celdas = 0;
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      for (const resultado of RESULTADOS) {
        for (const esCentral of [true, false]) {
          for (const esZonaEspecial of [true, false]) {
            const derivado = derivarIngresoOrden(
              {
                resultado,
                esCentral,
                esZonaEspecial,
                montoCobrar: CON_COD,
                cobraComision: true,
              },
              TARIFA,
            )[concepto];
            expect(
              satisface(concepto, {
                resultado,
                cobraComision: true,
                tarifa: TARIFA,
                montoCobrar: CON_COD,
              }),
              `celda ${concepto} / ${resultado} / esCentral=${esCentral} / esZonaEspecial=${esZonaEspecial}`,
            ).toBe(derivado !== undefined);
            celdas += 1;
          }
        }
      }
    }
    expect(celdas).toBe(120);
  });

  it("el criterio del COD recaudado admite los cinco resultados y suprime el recaudo en cero", () => {
    // El feed del ledger por tienda acumula `monto_recibido` de TODA gestion del cierre, mire lo
    // que mire el resultado. Lo unico que se le anade es la supresion de ceros, que aqui SI es
    // exacta: la suma de montos no negativos es > 0 exactamente cuando alguno lo es.
    let celdas = 0;
    for (const resultado of RESULTADOS) {
      for (const hayMontoRecibido of [true, false]) {
        expect(
          satisfaceCriterio(CRITERIO_COD_RECAUDADO, {
            resultado,
            cobraComision: false,
            hayTarifa: false,
            hayMontoCobrar: false,
            hayMontoRecibido,
          }),
          `celda cod_recaudado / ${resultado} / hayMontoRecibido=${hayMontoRecibido}`,
        ).toBe(hayMontoRecibido);
        celdas += 1;
      }
    }
    expect(celdas).toBe(10);
    // Y no exige tarifa ni comision: una gestion que recaudo entra aunque la tienda no tuviera
    // tarifa vigente, que es exactamente lo que hace el feed.
    expect(CRITERIO_COD_RECAUDADO.exigeTarifa).toBe(false);
    expect(CRITERIO_COD_RECAUDADO.exigeCobraComision).toBe(false);
  });

  it("FICHA 347 · el criterio del RECAUDO DE ENTREGA coincide con «esa gestion recaudo en una entrega»", () => {
    // Las 40 combinaciones de (resultado x cobraComision x hayTarifa x hayMontoRecibido). El
    // criterio de la 347 es MAS ESTRECHO que el del ledger (`CRITERIO_COD_RECAUDADO`): solo
    // `entregada`. Es ⟨Q1⟩, decidida por el humano, y aqui queda escrita como comportamiento.
    let celdas = 0;
    for (const resultado of RESULTADOS) {
      for (const cobraComision of [true, false]) {
        for (const hayTarifa of [true, false]) {
          for (const hayMontoRecibido of [true, false]) {
            const esperado = resultado === "entregada" && hayMontoRecibido;
            expect(
              satisfaceCriterio(CRITERIO_RECAUDO_ENTREGA, {
                resultado,
                cobraComision,
                hayTarifa,
                hayMontoCobrar: false,
                hayMontoRecibido,
              }),
              `celda recaudo_entrega / ${resultado} / com=${cobraComision} / tar=${hayTarifa} / rec=${hayMontoRecibido}`,
            ).toBe(esperado);
            celdas += 1;
          }
        }
      }
    }
    expect(celdas).toBe(40);
  });

  it("FICHA 347 · donde DIVERGE del criterio del ledger, y por que se acepta", () => {
    // Las 4 gestiones NO-entrega con recaudo: el ledger de la tienda SI las acredita
    // (`cod_recaudado`) y esta ficha NO las muestra. Medido en produccion: CERO gestiones con
    // recaudo que no sean entrega, asi que hoy las dos definiciones dan el mismo numero. El
    // filtro explicito existe para que la cifra no cambie sola el dia que eso deje de ser
    // cierto — no para cambiarla hoy.
    const divergentes = RESULTADOS.filter((r) => r !== "entregada");
    expect(divergentes).toEqual(["reprogramada", "devuelta", "rechazada", "incidente"]);
    for (const resultado of divergentes) {
      const hechos = {
        resultado,
        cobraComision: false,
        hayTarifa: false,
        hayMontoCobrar: false,
        hayMontoRecibido: true,
      };
      expect(satisfaceCriterio(CRITERIO_COD_RECAUDADO, hechos), resultado).toBe(true);
      expect(satisfaceCriterio(CRITERIO_RECAUDO_ENTREGA, hechos), resultado).toBe(false);
    }
  });

  it("ningun hecho del criterio es ajeno a las columnas de `cierre_detail` y `gestion_orden`", () => {
    // La tabla solo puede contener hechos ALMACENADOS: es lo que permite escribir el criterio en
    // el `WHERE`. Una clave nueva aqui obliga a decidir de que columna sale.
    const HECHOS_PERMITIDOS = [
      "resultados", // gestion_orden.resultado
      "exigeCobraComision", // cierre_detail.cobra_comision
      "exigeTarifa", // cierre_detail.tarifa_id
      "exigeMontoCobrar", // cierre_detail.monto_cobrar
      "exigeMontoRecibido", // gestion_orden.monto_recibido
    ];
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      expect(Object.keys(CRITERIO_DE_APORTE[concepto]).sort()).toEqual(
        [...HECHOS_PERMITIDOS].sort(),
      );
    }
    expect(Object.keys(CRITERIO_COD_RECAUDADO).sort()).toEqual([...HECHOS_PERMITIDOS].sort());
  });
});
