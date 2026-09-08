import { describe, it, expect } from "vitest";
import type { IngresoOrdenexDTO } from "@/lib/interfaces/services/ICierreDiaService";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import {
  cobradoSobreRecaudado,
  derivarIngresoOrden,
  efectivoCubreDescuentos,
  gananciaOrdenex,
  netoOrdenex,
  pagoTiendaOrdenex,
  paraLaCentral,
  totalesIngresoOrdenex,
} from "@/lib/utils/ingreso-ordenex";

/**
 * Feature 393 (B2) — la aritmetica de las DOS CASCADAS del cierre de bodega.
 *
 * TODOS los casos llevan CENTIMOS a proposito. Con cifras redondas estas identidades cierran
 * igual sin el arreglo —una resta de miles enteros da lo mismo con `Number` que con `Decimal`—
 * y el caso no probaria nada. La feature 204 midio 14 de 66 ordenes con un centimo de
 * desviacion, y aqui hay RESTAS NUEVAS.
 *
 * Cubre R6, R7, R8, R9, R36 y R37.
 */

// Una tarifa REAL con centimos, para anclar la trampa 1 en la derivacion de produccion y no en
// una suposicion de este archivo.
const TARIFA: TarifaVigente = {
  valorFlete: "2500.55",
  valorFleteGam: "1800.35",
  valorFleteDevuelto: "1200.45",
  valorFleteDevueltoGam: "900.25",
  comisionCod: "3.5", // %
  ivaFlete: "13", // %
  ivaComisionCod: "13", // %
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/**
 * Un desglose por gestion. Cada literal es INTERNAMENTE COHERENTE (`total` = suma de los
 * conceptos presentes), que es la unica forma en que `totalesIngresoOrdenex` puede estar
 * sumando bien o mal de manera observable.
 */
function ingreso(over: Partial<IngresoOrdenexDTO>): IngresoOrdenexDTO {
  return {
    montoCobrar: null,
    cobraComision: false,
    esCentral: false,
    esZonaEspecial: false,
    fleteOrigen: "normal",
    fleteDevolucionOrigen: "normal",
    flete: null,
    ivaFlete: null,
    fleteDevolucion: null,
    ivaFleteDevolucion: null,
    comisionCod: null,
    ivaComisionCod: null,
    fleteConIva: null,
    fleteDevolucionConIva: null,
    comisionConIva: null,
    total: "0.00",
    tarifa: null,
    ...over,
  };
}

/** Tres entregadas identicas + un rechazo. Los centimos NO son redondos en ninguna. */
const UNA_ENTREGADA = ingreso({
  fleteConIva: "1234.57",
  comisionConIva: "89.13",
  total: "1323.70",
});
const UN_RECHAZO = ingreso({
  fleteDevolucionConIva: "456.79",
  total: "456.79",
});
const GESTIONES = [
  { ingresoOrdenex: UNA_ENTREGADA },
  { ingresoOrdenex: UNA_ENTREGADA },
  { ingresoOrdenex: UNA_ENTREGADA },
  { ingresoOrdenex: UN_RECHAZO },
];

describe("feature 393 — cascada A: de quien es el dinero", () => {
  it("1 · `netoOrdenex` resta TAMBIEN la bodega, asi que con bodega > 0 NO es `gananciaOrdenex` (R8)", () => {
    const facturado = "27134.83";
    const mensajeros = "14000.00";
    const ganaBodega = "1250.45";

    const neto = netoOrdenex(facturado, mensajeros, ganaBodega);
    const ganancia = gananciaOrdenex(facturado, mensajeros);

    expect(neto).toBe("11884.38");
    expect(ganancia).toBe("13134.83");
    // No es un "son distintos" vago: la diferencia es EXACTAMENTE el pago a la bodega, que es
    // el sustraendo que `gananciaOrdenex` no conoce.
    expect(neto).not.toBe(ganancia);
    expect(netoOrdenex(ganancia, ganaBodega, "0.00")).toBe(neto);
  });

  it("2 · con la bodega en cero, `netoOrdenex` coincide al centimo con `gananciaOrdenex` — el cierre que se midio (R8)", () => {
    const facturado = "27134.83";
    const mensajeros = "14000.00";

    // El cierre `ae93cdcd-…-4e803514934d` que el humano miro: ahi la bodega era 0, y por eso
    // los dos numeros se veian iguales. Coincidir en ese cierre NO los hace la misma cifra.
    expect(netoOrdenex(facturado, mensajeros, "0.00")).toBe(
      gananciaOrdenex(facturado, mensajeros),
    );
    expect(netoOrdenex(facturado, mensajeros, "0.00")).toBe("13134.83");
  });

  it("6 · lo facturado es la suma de los TRES conceptos, sin perder un centimo al agregar (R7)", () => {
    const t = totalesIngresoOrdenex(GESTIONES);

    expect(t.fleteConIva).toBe("3703.71");
    expect(t.comisionConIva).toBe("267.39");
    expect(t.fleteDevolucionConIva).toBe("456.79");
    expect(t.total).toBe("4427.89");

    // La identidad de R7 sobre las cifras agregadas, no sobre las de una gestion.
    expect(cobradoSobreRecaudado(t.fleteConIva, t.comisionConIva)).toBe("3971.10");
    expect(
      cobradoSobreRecaudado(
        cobradoSobreRecaudado(t.fleteConIva, t.comisionConIva),
        t.fleteDevolucionConIva,
      ),
    ).toBe(t.total);
  });

  it("7 · el flete por rechazo se factura pero NO sale de lo recaudado: la linea puente explica la diferencia exacta (R6/R10)", () => {
    // La premisa, leida de la derivacion de PRODUCCION y no supuesta aqui: una `rechazada`
    // emite flete de devolucion y NO emite flete de entrega ni comision.
    const rechazada = derivarIngresoOrden(
      {
        resultado: "rechazada",
        esCentral: false,
        esZonaEspecial: false,
        montoCobrar: "9999.99",
        cobraComision: true,
      },
      TARIFA,
    );
    expect(rechazada.ingreso_flete).toBeUndefined();
    expect(rechazada.ingreso_comision_cod).toBeUndefined();
    expect(rechazada.ingreso_flete_devolucion).toBeDefined();

    const t = totalesIngresoOrdenex(GESTIONES);
    const general = "5000.33";
    const paraLaTienda = pagoTiendaOrdenex(general, t.fleteConIva, t.comisionConIva);

    expect(paraLaTienda).toBe("1029.23");

    // (a) Empezar la cascada por el BRUTO facturado NO da «para la tienda» (alternativa A6).
    const restandoElBruto = pagoTiendaOrdenex(general, t.total, "0.00");
    expect(restandoElBruto).toBe("572.44");
    expect(restandoElBruto).not.toBe(paraLaTienda);

    // (b) La linea puente es exactamente lo que hay que restar para que SI de.
    expect(pagoTiendaOrdenex(general, cobradoSobreRecaudado(t.fleteConIva, t.comisionConIva), "0.00")).toBe(
      paraLaTienda,
    );
    // (c) Y el hueco entre las dos lecturas es, al centimo, el flete por rechazo + IVA.
    expect(pagoTiendaOrdenex(paraLaTienda, restandoElBruto, "0.00")).toBe(t.fleteDevolucionConIva);
  });
});

describe("feature 393 — cascada B: lo que la satelite le entrega a la central", () => {
  it("3 · «Para la central» = lo recaudado menos los dos descuentos que la bodega registra (R9)", () => {
    expect(paraLaCentral("126089.17", "14000.55", "1250.45")).toBe("110838.17");
    // Los dos sustraendos cuentan: quitar cualquiera de los dos cambia el resultado.
    expect(paraLaCentral("126089.17", "14000.55", "0.00")).toBe("112088.62");
    expect(paraLaCentral("126089.17", "0.00", "1250.45")).toBe("124838.72");
  });

  it("4 · sale NEGATIVO con su signo y NUNCA «0.00» cuando los descuentos superan lo recaudado (R36)", () => {
    // Medido contra produccion el 2026-09-08: 1 de 14 cierres de bodega ya estaba asi. Y sale
    // de la estructura de la formula —el pago al mensajero es FIJO por entrega, y una entrega
    // prepagada aporta cero al total y aun asi paga—, no de un dato raro.
    const soloMensajeros = paraLaCentral("8500.35", "9500.40", "0.00");
    expect(soloMensajeros).toBe("-1000.05");
    expect(soloMensajeros).not.toBe("0.00");
    expect(soloMensajeros.startsWith("-")).toBe(true);

    // Tambien cuando el que lo hunde es el segundo descuento.
    const conBodega = paraLaCentral("8500.35", "9000.00", "1500.40");
    expect(conBodega).toBe("-2000.05");
    expect(conBodega.startsWith("-")).toBe(true);

    // Un cierre entero sin recaudo: la satelite no entrega nada y la central pone TODO.
    expect(paraLaCentral("0.00", "3400.15", "0.00")).toBe("-3400.15");
  });

  it("5 · el aviso del efectivo mira el EFECTIVO, no el general: salta aunque «Para la central» sea positivo (R37)", () => {
    const general = "20000.50";
    const efectivo = "3000.00";
    const mensajeros = "14000.55";

    // Positivo, y aun asi la bodega no tiene con que pagar: lo demas entro por SINPE o
    // transferencia. Medido contra produccion: 2 de 14 cierres, el peor por -2.000.
    expect(paraLaCentral(general, mensajeros, "0.00")).toBe("5999.95");
    expect(efectivoCubreDescuentos(efectivo, mensajeros, "0.00")).toBe(false);
    // Comparar contra el GENERAL responderia otra pregunta y dejaria el aviso mudo justo aqui.
    expect(efectivoCubreDescuentos(general, mensajeros, "0.00")).toBe(true);

    // El borde exacto, al centimo: alcanza justo -> true; un centimo menos -> false.
    expect(efectivoCubreDescuentos("14000.55", mensajeros, "0.00")).toBe(true);
    expect(efectivoCubreDescuentos("14000.54", mensajeros, "0.00")).toBe(false);

    // Y los DOS descuentos cuentan, no solo el del mensajero.
    expect(efectivoCubreDescuentos("14000.55", mensajeros, "0.01")).toBe(false);
  });

  it("no emite ningun importe en coma flotante: las salidas son STRING de escala 2 (R12/R14)", () => {
    const salidas = [
      netoOrdenex("0.10", "0.20", "0.30"),
      paraLaCentral("0.10", "0.20", "0.30"),
      cobradoSobreRecaudado("0.10", "0.20"),
    ];
    for (const s of salidas) {
      expect(typeof s).toBe("string");
      expect(s).toMatch(/^-?\d+\.\d{2}$/);
    }
    // El caso clasico de la coma flotante: 0.1 + 0.2 no es 0.30000000000000004 aqui.
    expect(cobradoSobreRecaudado("0.10", "0.20")).toBe("0.30");
    expect(netoOrdenex("0.10", "0.20", "0.30")).toBe("-0.40");
  });
});
