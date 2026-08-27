import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaPremioRankingTxClient,
  ICajaPremioRankingFeedService,
  MovimientoDeCajaDePremio,
} from "@/lib/interfaces/services/ICajaPremioRankingFeedService";

/**
 * Feature 293 (T4.1, design §7.1, R20/R29) — el puerto por el que el premio del ranking mueve la
 * CAJA PRINCIPAL: **el dinero sale al registrar el premio y vuelve al anularlo**.
 *
 * Es la unica implementacion de `ICajaPremioRankingFeedService` y aqui vive lo que el puerto NO
 * deja decidir a quien lo llama: el `tipo`, la `categoria` y el `origenTipo` de las dos filas.
 * Estan escritos como LITERALES, una vez cada uno, y no salen de ningun parametro — de modo que
 * `PremioRankingDevengoService` no tiene forma de emitir otra cosa en la caja aunque quisiera.
 *
 * Como su hermano de la 173, este SI persiste: el patron «devuelvo filas y otro las inserta» solo
 * funciona cuando quien las inserta ya tiene el repositorio de la caja, y el servicio del premio
 * —a proposito— no lo tiene ni lo va a tener. Que el repositorio quede encapsulado AQUI es justo
 * lo que hace estrecho al puerto.
 *
 * Money-safe: el monto viaja como STRING de punta a punta y esta clase no hace aritmetica alguna
 * — el importe es EL MISMO que ya se escribio en el libro del mensajero, y los dos salen del
 * podio CONGELADO (R15).
 */
export class CajaPremioRankingFeedService implements ICajaPremioRankingFeedService {
  constructor(private readonly cajaRepo: IWalletMovimientoRepository) {}

  /**
   * R20 — el egreso del premio, en la `tx` que se le da.
   *
   * `origenTipo`/`origenId` apuntan A LA FILA DEL PODIO, no al cierre: es lo que le da clave
   * propia y, con ella, la idempotencia gratis del unico parcial de la caja. Con el cierre, esta
   * fila caeria en `DO NOTHING` contra el `egreso_pago_mensajero` que el feed ya escribio al
   * aprobar (design §3.4/§11-C).
   *
   * NO se pasa `fechaMovimiento` (R23): el egreso se fecha en el INSTANTE DEL REGISTRO.
   */
  async emitirEgresoPremio(
    tx: CajaPremioRankingTxClient,
    movimiento: MovimientoDeCajaDePremio,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_pago_mensajero", // naturaleza PROPIA: es dinero de Ordenex
        monto: movimiento.monto,
        origenTipo: "ranking_snapshot_fila", // R20: la FILA DEL PODIO, nunca el cierre
        origenId: movimiento.filaId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
      },
    ]);
  }

  /**
   * R29 — el reverso de la anulacion, con la MISMA clave de origen que el egreso y otra
   * categoria: caben las dos filas y ninguna puede duplicarse.
   *
   * `ingreso_ajuste` y no un `ingreso_reverso_*` nuevo: el egreso original ya era PROPIO, asi que
   * revertirlo por aqui deja la ganancia exactamente como estaba (design §7.1).
   */
  async reversarEgresoPremio(
    tx: CajaPremioRankingTxClient,
    movimiento: MovimientoDeCajaDePremio,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "ingreso",
        categoria: "ingreso_ajuste", // naturaleza PROPIA, como el egreso que revierte
        monto: movimiento.monto,
        origenTipo: "ranking_snapshot_fila", // la MISMA clave que el egreso
        origenId: movimiento.filaId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
      },
    ]);
  }
}
