// FICHA 347 — constructores de fixtures del DINERO por producto, compartidos por los tests de
// unidad del servicio, del modulo puro y del detalle.
//
// NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
//
// ⚠ LOS NUMEROS DE LA TARIFA SE ESCRIBEN A MANO Y NO SE LEEN DE NADA. Es deliberado: un fixture
// derivado de la propia fuente que se prueba deja el test siempre verde (la leccion de
// «asercion contra su propia fuente»). Con estos valores, una entrega de `montoCobrar` 10.000
// que cobra comision deriva, a mano:
//
//   flete            = 3.000,00
//   iva flete        = 13 % de 3.000  =   390,00
//   comision COD     =  5 % de 10.000 =   500,00
//   iva comision     = 13 % de 500    =    65,00
//   ordenex          = 3.955,00
//   tienda           = 10.000 - 3.390 - 565 = 6.045,00
//
// y un rechazo deriva `retorno = 2.000 + 13 % = 2.260,00`.

import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type {
  FilaDineroCruda,
  IDineroProductosRepository,
  LecturaDineroProductos,
} from "@/lib/interfaces/repositories/IDineroProductosRepository";
import type { OrdenCongelada } from "@/lib/utils/aporte-por-orden";
import type { GestionResultado } from "@prisma/client";

/** La tarifa congelada de las pruebas. Valores escritos a mano (ver cabecera). */
export const TARIFA: TarifaVigente = {
  valorFlete: "3000.00",
  valorFleteGam: "2500.00",
  valorFleteDevuelto: "2000.00",
  valorFleteDevueltoGam: "1800.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/** Las entradas congeladas de una orden en un cierre. `tarifa: null` = gap R9 (sin tarifa). */
export function congelada(opts: Partial<OrdenCongelada> = {}): OrdenCongelada {
  return {
    esCentral: false,
    esZonaEspecial: false,
    montoCobrar: "10000.00",
    cobraComision: true,
    tarifa: TARIFA,
    ...opts,
  };
}

export interface OpcionesFilaDinero {
  ordenId?: string;
  tiendaId?: string;
  tiendaNombre?: string;
  producto?: string;
  guia?: string;
  destinatario?: string;
  numGuia?: number | null;
  gestionId?: string;
  resultado?: GestionResultado;
  montoRecibido?: string | null;
  /** `"aprobado"` = liquidada (si ademas hay tarifa congelada); `null` = sin cierre. */
  cierreEstado?: string | null;
  congelada?: OrdenCongelada | null;
}

/** Una fila cruda del dinero: el grano `(orden, gestion)` que devuelve el repositorio. */
export function filaDinero(opts: OpcionesFilaDinero = {}): FilaDineroCruda {
  const ordenId = opts.ordenId ?? "o1";
  return {
    ordenId,
    tiendaId: opts.tiendaId ?? "t1",
    tiendaNombre: opts.tiendaNombre ?? "Tienda Uno",
    producto: opts.producto ?? "1 * Base C",
    guia: opts.guia ?? `g-${ordenId}`,
    numGuia: opts.numGuia === undefined ? null : opts.numGuia,
    destinatario: opts.destinatario ?? "Destinatario",
    gestionId: opts.gestionId ?? `${ordenId}-g1`,
    resultado: opts.resultado ?? "entregada",
    montoRecibido: opts.montoRecibido === undefined ? "10000.00" : opts.montoRecibido,
    cierreEstado: opts.cierreEstado === undefined ? "aprobado" : opts.cierreEstado,
    congelada: opts.congelada === undefined ? congelada() : opts.congelada,
  };
}

/**
 * Doble del repositorio de dinero que CUENTA LLAMADAS.
 *
 * El contador no es decorativo: R5 exige que con el dinero denegado el repositorio NO se llame
 * ni una vez, y eso solo se puede afirmar contando. Un `SELECT` que se lanza para tirar el
 * resultado ya habria leido el dinero.
 */
export function dineroFalso(
  filas: readonly FilaDineroCruda[] = [],
  lectura?: LecturaDineroProductos,
): IDineroProductosRepository & { llamadas: number } {
  return {
    llamadas: 0,
    async leerDineroPorOrden(): Promise<LecturaDineroProductos> {
      this.llamadas += 1;
      return lectura ?? { estado: "ok", filas };
    },
  } as IDineroProductosRepository & { llamadas: number };
}
