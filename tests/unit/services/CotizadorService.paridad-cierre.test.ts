import { describe, expect, it, vi } from "vitest";

import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { CotizadorService } from "@/lib/services/CotizadorService";
import type { CotizacionApiEntrada, CotizacionConCostos } from "@/lib/types/cotizador";
import { agregarIngresosPorConcepto } from "@/lib/utils/ingreso-ordenex";

// Feature 248 (T5, R24) — PARIDAD CON EL CIERRE, DIGITO A DIGITO.
//
// Este archivo es la razon de ser de R23/D5. El cotizador enseña dinero que la tienda comparara
// contra su cierre; si divergiera un centimo, la misma plata se leeria distinta segun por donde
// se mire. `lib/utils/ingreso-ordenex.ts:121-146` documenta que eso YA PASO: la version que
// reimplementaba estas formulas en el navegador desviaba un centimo en 14 de 66 ordenes reales.
//
// Asi que aqui no se comparan importes contra literales escritos a mano (eso solo probaria que
// sabemos multiplicar): se comparan contra lo que el CIERRE acumula para la misma gestion via
// `agregarIngresosPorConcepto`, que es la funcion que decide lo que de verdad se factura.
//
// Se usan los DOS montos citados en el docstring de `ingreso-ordenex.ts` —14 900,00 (el caso del
// medio exacto no representable en binario) y 16 618,40 (el caso que NO era binario, sino OTRA
// formula: le faltaba un redondeo intermedio)— mas dos montos redondos de control.

const TARIFA: TarifaVigente = {
  valorFlete: "2000.00",
  valorFleteGam: "2200.00",
  valorFleteDevuelto: "1400.00",
  valorFleteDevueltoGam: "1500.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

const ACTOR: Actor = { usuarioId: "tienda-de-la-key", rol: "apiKey" };

function serviceCon(esCentral: boolean): CotizadorService {
  const cobertura: ICoberturaService = {
    consultar: vi.fn().mockResolvedValue({
      estado: "cubierto",
      distritoId: "d1",
      zonaId: "z1",
      zonaNombre: esCentral ? "GAM" : "Periferia",
      esCentral,
    }),
  };
  const tarifas: ITarifaVigentePorTiendaRepository = {
    resolveTarifaPorTienda: vi.fn().mockResolvedValue(TARIFA),
    resolveTarifasPorTiendas: vi.fn(),
  };
  return new CotizadorService(cobertura, tarifas);
}

function entrada(over: Partial<CotizacionApiEntrada>): CotizacionApiEntrada {
  return {
    provincia: "San José",
    canton: "Central",
    distrito: "Carmen",
    monto_cobrar: "25000.00",
    cantidad: 1,
    cobra_comision: true,
    ...over,
  };
}

/** Lo que el CIERRE acumula para UNA gestion con ese resultado (mapa concepto -> monto). */
function conceptosDelCierre(
  resultado: "entregada" | "devuelta",
  esCentral: boolean,
  montoCobrar: string,
  cobraComision: boolean,
): Record<string, string> {
  const agregado = agregarIngresosPorConcepto([
    { input: { resultado, esCentral, montoCobrar, cobraComision }, tarifa: TARIFA },
  ]);
  return Object.fromEntries(agregado.map((c) => [c.categoria, c.monto]));
}

const MONTOS = ["14900.00", "16618.40", "25000.00", "0.00"];

describe("CotizadorService: paridad con el cierre (R24)", () => {
  for (const esCentral of [true, false]) {
    for (const cobraComision of [true, false]) {
      for (const monto of MONTOS) {
        const etiqueta = `monto ${monto}, esCentral ${esCentral}, cobraComision ${cobraComision}`;
        it(`R24: para la misma entrada los conceptos coinciden dígito a dígito con agregarIngresosPorConcepto (${etiqueta})`, async () => {
          const respuesta = (await serviceCon(esCentral).cotizar(
            ACTOR,
            entrada({ monto_cobrar: monto, cobra_comision: cobraComision }),
          )) as CotizacionConCostos;

          const entregadaCierre = conceptosDelCierre("entregada", esCentral, monto, cobraComision);
          const devueltaCierre = conceptosDelCierre("devuelta", esCentral, monto, cobraComision);
          const entregada = respuesta.escenarios.entregada.unitario;
          const devuelta = respuesta.escenarios.devuelta.unitario;

          // `agregarIngresosPorConcepto` OMITE los conceptos con total "0.00" (R10 de la 42),
          // asi que el cotizador equivale a "el monto del cierre, o cero si no lo emitio".
          const cierre = (mapa: Record<string, string>, clave: string): string =>
            mapa[clave] ?? "0.00";

          expect(entregada.flete).toBe(cierre(entregadaCierre, "ingreso_flete"));
          expect(entregada.ivaFlete).toBe(cierre(entregadaCierre, "ingreso_iva_flete"));
          expect(entregada.comisionCod ?? "0.00").toBe(
            cierre(entregadaCierre, "ingreso_comision_cod"),
          );
          expect(entregada.ivaComisionCod ?? "0.00").toBe(
            cierre(entregadaCierre, "ingreso_iva_comision_cod"),
          );
          expect(devuelta.fleteDevolucion).toBe(
            cierre(devueltaCierre, "ingreso_flete_devolucion"),
          );
          expect(devuelta.ivaFleteDevolucion).toBe(
            cierre(devueltaCierre, "ingreso_iva_flete_devolucion"),
          );

          // R33 — con `cobraComision: false` el cierre no emite comision NI su IVA, y el
          // cotizador no los emite tampoco: ausentes en ambos lados, no "0.00" en ninguno.
          if (!cobraComision) {
            expect(entregadaCierre.ingreso_comision_cod).toBeUndefined();
            expect("comisionCod" in entregada).toBe(false);
          }
        });
      }
    }
  }

  it("R24: los dos casos MEDIDOS del docstring salen con el redondeo intermedio del cierre", async () => {
    // 14 900,00 -> comision 521,50; IVA exacto 67,795 -> HALF_UP -> 67,80 (el navegador daba
    // 67,79 porque 521,5 * 1,13 no es representable en binario).
    const a = (await serviceCon(true).cotizar(
      ACTOR,
      entrada({ monto_cobrar: "14900.00" }),
    )) as CotizacionConCostos;
    expect(a.escenarios.entregada.unitario.comisionCod).toBe("521.50");
    expect(a.escenarios.entregada.unitario.ivaComisionCod).toBe("67.80");

    // 16 618,40 -> comision 581,644 REDONDEADA A 581,64 ANTES del IVA; 13 % de 581,64 = 75,6132
    // -> 75,61. El navegador aplicaba el IVA a la comision sin redondear y daba 75,62 (657,26
    // sumando): no era binario, era OTRA formula.
    const b = (await serviceCon(true).cotizar(
      ACTOR,
      entrada({ monto_cobrar: "16618.40" }),
    )) as CotizacionConCostos;
    expect(b.escenarios.entregada.unitario.comisionCod).toBe("581.64");
    expect(b.escenarios.entregada.unitario.ivaComisionCod).toBe("75.61");
  });
});
