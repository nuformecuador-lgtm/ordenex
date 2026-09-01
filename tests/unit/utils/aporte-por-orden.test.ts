import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import {
  agregarIngresosPorConcepto,
  type OrdenIngresoInput,
} from "@/lib/utils/ingreso-ordenex";
import {
  FUENTE_CAJA,
  FUENTE_TIENDA,
  aporteDeOrden,
  type GestionDelCierre,
  type OrdenCongelada,
} from "@/lib/utils/aporte-por-orden";
import { conceptoIngresoADebitoTienda } from "@/lib/utils/mapeo-concepto-tienda";
import {
  WALLET_INGRESO_CONCEPTO_SEED,
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type WalletIngresoConcepto,
} from "@/lib/types/wallet";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";
import { MOTIVO_SIN_REPARTO_SEED } from "@/lib/types/detalle-movimiento";

/**
 * Ficha 344 (T1.5, R22/R46/R49) — la PARTICION por orden y los dos catalogos.
 *
 * Lo que se prueba aqui y no en otro sitio: que repartir el importe de un concepto entre las
 * ordenes que lo componen da EXACTAMENTE el importe que el feed emitio. Si esa identidad no
 * fuera exacta, el detalle mostraria filas que suman otra cosa que la fila que se abrio, y el
 * usuario tendria dos numeros distintos del mismo dinero.
 */

/** Tarifa con porcentajes que producen redondeos INTERMEDIOS: es donde una deriva aparece. */
const TARIFA: TarifaVigente = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/** La tarifa que estaria VIGENTE hoy, distinta de la congelada. No debe influir en nada. */
const TARIFA_VIGENTE_HOY: TarifaVigente = { ...TARIFA, valorFlete: "9999.00" };

interface OrdenSintetica {
  orden: OrdenCongelada;
  gestiones: GestionDelCierre[];
}

/**
 * El conjunto sintetico: una orden por caso que importa, con los importes de la ficha 204 —
 * `14900.00` y `16618.40` son los dos COD reales que allí produjeron un centimo de diferencia
 * segun donde se redondeara. Si la particion por orden tuviera deriva, aparece aqui.
 */
const CONJUNTO: OrdenSintetica[] = [
  // Entrega normal con COD que produce comision con decimales (521.5 -> 521.50).
  {
    orden: {
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "14900.00",
      cobraComision: true,
      tarifa: TARIFA,
    },
    gestiones: [{ resultado: "entregada", montoRecibido: "14900.00" }],
  },
  // Entrega con el COD que redondea hacia arriba en el paso intermedio (581.644 -> 581.64).
  {
    orden: {
      esCentral: true,
      esZonaEspecial: false,
      montoCobrar: "16618.40",
      cobraComision: true,
      tarifa: TARIFA,
    },
    gestiones: [{ resultado: "entregada", montoRecibido: "16618.40" }],
  },
  // R20: UNA orden con DOS gestiones que aportan al mismo concepto en el mismo cierre.
  {
    orden: {
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "7333.33",
      cobraComision: true,
      tarifa: TARIFA,
    },
    gestiones: [
      { resultado: "entregada", montoRecibido: "3000.00" },
      { resultado: "entregada", montoRecibido: "4333.33" },
    ],
  },
  // Un rechazo: aporta a los DOS conceptos de devolucion y a ninguno de entrega.
  {
    orden: {
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "5000.00",
      cobraComision: true,
      tarifa: TARIFA,
    },
    gestiones: [{ resultado: "rechazada", montoRecibido: null }],
  },
  // R23: sin tarifa congelada no deriva NINGUN concepto, y su ausencia no altera la suma.
  {
    orden: {
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "20000.00",
      cobraComision: true,
      tarifa: null,
    },
    gestiones: [{ resultado: "entregada", montoRecibido: "20000.00" }],
  },
  // Resultados que no aportan a ningun concepto derivado, pero SI al COD recaudado.
  {
    orden: {
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "1000.00",
      cobraComision: false,
      tarifa: TARIFA,
    },
    gestiones: [
      { resultado: "devuelta", montoRecibido: null },
      { resultado: "reprogramada", montoRecibido: "250.75" },
    ],
  },
];

/** Las gestiones del conjunto, APLANADAS: es exactamente lo que el feed recorre. */
function entradasDelFeed(): Array<{ input: OrdenIngresoInput; tarifa: TarifaVigente | null }> {
  return CONJUNTO.flatMap(({ orden, gestiones }) =>
    gestiones.map((g) => ({
      input: {
        resultado: g.resultado,
        esCentral: orden.esCentral,
        esZonaEspecial: orden.esZonaEspecial,
        montoCobrar: orden.montoCobrar,
        cobraComision: orden.cobraComision,
      },
      tarifa: orden.tarifa,
    })),
  );
}

/** Σ de los aportes por ORDEN de un concepto, como lo hace el detalle. */
function sumaPorOrden(concepto: WalletIngresoConcepto): string {
  const fuente = { tipo: "concepto_ordenex", concepto } as const;
  return CONJUNTO.reduce(
    (acc, o) => acc.plus(aporteDeOrden(fuente, o.orden, o.gestiones) ?? 0),
    new Prisma.Decimal(0),
  ).toFixed(2);
}

describe("ficha 344 — el aporte por orden (R22/R46/R49)", () => {
  it("sumar los aportes por orden da el mismo agregado que el feed", () => {
    const emitidos = agregarIngresosPorConcepto(entradasDelFeed());
    let conceptosConDinero = 0;
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      // El feed OMITE los conceptos cuyo total es 0.00; para esos, la Σ del detalle es 0.00.
      const delFeed = emitidos.find((c) => c.categoria === concepto)?.monto ?? "0.00";
      expect(sumaPorOrden(concepto), `el concepto ${concepto} no cuadra`).toBe(delFeed);
      if (new Prisma.Decimal(delFeed).gt(0)) conceptosConDinero += 1;
    }
    // NO-VACUIDAD: los seis conceptos tienen dinero de verdad en este conjunto (dos de entrega,
    // dos de devolucion y los dos de comision). Un `0.00 === 0.00` seis veces no probaria nada.
    expect(conceptosConDinero, "el conjunto sintetico no produjo dinero en los seis conceptos").toBe(6);
  });

  it("una orden con dos gestiones aporta la SUMA de las dos, sin perder ni inventar un centimo", () => {
    const dosGestiones = CONJUNTO[2];
    const fuente = { tipo: "concepto_ordenex", concepto: "ingreso_comision_cod" } as const;
    const juntas = aporteDeOrden(fuente, dosGestiones.orden, dosGestiones.gestiones);
    const primera = aporteDeOrden(fuente, dosGestiones.orden, [dosGestiones.gestiones[0]]);
    const segunda = aporteDeOrden(fuente, dosGestiones.orden, [dosGestiones.gestiones[1]]);
    expect(juntas?.toFixed(2)).toBe(primera!.plus(segunda!).toFixed(2));
    // Y no es una copia disfrazada: las dos gestiones son de la MISMA orden, asi que el aporte
    // conjunto es el DOBLE del de una. Sin esto, un `aporteDeOrden` que ignorara la segunda
    // gestion pasaria el `toBe` de arriba.
    expect(juntas?.toFixed(2)).toBe(primera!.times(2).toFixed(2));
    expect(juntas?.gt(0)).toBe(true);
  });

  it("la orden sin tarifa congelada no aporta a ningun concepto derivado (R23)", () => {
    const sinTarifa = CONJUNTO[4];
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      expect(
        aporteDeOrden({ tipo: "concepto_ordenex", concepto }, sinTarifa.orden, sinTarifa.gestiones),
        `la orden sin tarifa aporto a ${concepto}`,
      ).toBeUndefined();
    }
    // Pero SI aporta al COD recaudado: ese credito no depende de la tarifa.
    expect(
      aporteDeOrden({ tipo: "cod_recaudado" }, sinTarifa.orden, sinTarifa.gestiones)?.toFixed(2),
    ).toBe("20000.00");
  });

  it("el aporte se deriva del snapshot congelado, no de datos vivos (R22)", () => {
    const orden = CONJUNTO[0];
    const fuente = { tipo: "concepto_ordenex", concepto: "ingreso_flete" } as const;
    // Con la tarifa CONGELADA (la que guardo `cierre_detail`) el flete es el de entonces...
    expect(aporteDeOrden(fuente, orden.orden, orden.gestiones)?.toFixed(2)).toBe("1000.00");
    // ...y con la que estaria vigente HOY seria otro numero. La funcion no tiene forma de leer
    // la vigente: solo ve lo que se le pasa, y quien se lo pasa es el repositorio desde
    // `cierre_detail` (ver `tests/unit/repositories/cierre-aporte-repository.test.ts`, que
    // afirma que la consulta no toca `tarifas` ni `orden` vivas).
    expect(
      aporteDeOrden(
        fuente,
        { ...orden.orden, tarifa: TARIFA_VIGENTE_HOY },
        orden.gestiones,
      )?.toFixed(2),
    ).toBe("9999.00");
  });

  it("el COD recaudado acumula el recaudo de TODAS las gestiones, con o sin recaudo", () => {
    const conYSinRecaudo = CONJUNTO[5];
    expect(
      aporteDeOrden({ tipo: "cod_recaudado" }, conYSinRecaudo.orden, conYSinRecaudo.gestiones)
        ?.toFixed(2),
    ).toBe("250.75"); // la `devuelta` sin recaudo entra como 0, no se salta
    // Σ del conjunto entero: es lo que el feed acredita a la tienda por ese cierre.
    const total = CONJUNTO.reduce(
      (acc, o) => acc.plus(aporteDeOrden({ tipo: "cod_recaudado" }, o.orden, o.gestiones) ?? 0),
      new Prisma.Decimal(0),
    );
    expect(total.toFixed(2)).toBe("59102.48");
  });

  it("los dos catalogos cubren todas las categorias de sus enums (R49)", () => {
    // Un `Record` TOTAL ya lo garantiza en tiempo de compilacion; esto lo afirma en RUNTIME, que
    // es lo que sobrevive a un `as` mal puesto.
    expect(Object.keys(FUENTE_CAJA).sort()).toEqual([...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect(Object.keys(FUENTE_TIENDA).sort()).toEqual(
      [...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort(),
    );
    // Y todo motivo declarado pertenece al catalogo de motivos (nada de texto libre).
    for (const fuente of [...Object.values(FUENTE_CAJA), ...Object.values(FUENTE_TIENDA)]) {
      if (fuente.tipo === "sin_reparto") {
        expect(MOTIVO_SIN_REPARTO_SEED).toContain(fuente.motivo);
      }
    }
  });

  it("el catalogo de la tienda es la INVERSA del mapeo concepto -> debito, no una segunda copia", () => {
    // Si alguien reescribiera a mano una entrada de `FUENTE_TIENDA`, el debito `flete` podria
    // acabar apuntando al concepto del IVA y la tienda veria las ordenes de otro numero.
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      expect(FUENTE_TIENDA[conceptoIngresoADebitoTienda(concepto)]).toEqual({
        tipo: "concepto_ordenex",
        concepto,
      });
    }
  });

  it("los tres conceptos de la caja que NO se reparten lo declaran con su motivo (R48)", () => {
    expect(FUENTE_CAJA.egreso_pago_mensajero).toEqual({
      tipo: "sin_reparto",
      motivo: "snapshot_del_cierre",
    });
    expect(FUENTE_CAJA.ingreso_cod_recaudado).toEqual({
      tipo: "sin_reparto",
      motivo: "suma_del_libro_por_tienda",
    });
    expect(FUENTE_CAJA.egreso_indemnizacion).toEqual({
      tipo: "sin_reparto",
      motivo: "otro_productor",
    });
    // Y los seis conceptos del feed SI se reparten: sin esto, un catalogo entero en
    // `sin_reparto` pasaria los tres `toEqual` de arriba.
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      expect(FUENTE_CAJA[concepto]).toEqual({ tipo: "concepto_ordenex", concepto });
    }
  });

  it("una fuente sin reparto no deriva ningun aporte", () => {
    const orden = CONJUNTO[0];
    expect(
      aporteDeOrden(
        { tipo: "sin_reparto", motivo: "snapshot_del_cierre" },
        orden.orden,
        orden.gestiones,
      ),
    ).toBeUndefined();
  });
});
