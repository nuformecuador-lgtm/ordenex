import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaPagoTiendaTxClient,
  ICajaPagoTiendaFeedService,
  MovimientoDeCajaDePagoTienda,
} from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";

/**
 * Feature 173 (design §3.2/§3.3/§4, R18-R20 y R24-R26) — el puerto por el que la liquidacion
 * mueve la caja principal: **el dinero sale al pagar a una tienda y vuelve al anular ese pago**.
 *
 * Es la unica implementacion de `ICajaPagoTiendaFeedService` y aqui vive lo que el puerto NO
 * deja decidir a quien lo llama: el `tipo`, la `categoria` y el `origenTipo` de las dos filas.
 * Estan escritos como literales, una vez cada uno, y no salen de ningun parametro — de modo que
 * `LiquidacionService` no tiene forma de emitir `egreso_pago_mensajero` ni ninguna otra
 * categoria, aunque quisiera (R23).
 *
 * A diferencia de sus hermanos (`CajaCodFeedService`, `WalletFeedService`…), este SI persiste:
 * el patron «devuelvo filas y otro las inserta» solo funciona cuando quien las inserta ya tiene
 * el repositorio de la caja, y la liquidacion —a proposito— no lo tiene ni lo va a tener. Que el
 * repositorio quede encapsulado AQUI es justo lo que hace estrecho al puerto.
 *
 * Money-safe: el monto viaja como STRING de punta a punta y esta clase no hace aritmetica
 * alguna — el importe es EL MISMO que ya se escribio en el documento y en el ledger.
 */
export class CajaPagoTiendaFeedService implements ICajaPagoTiendaFeedService {
  constructor(private readonly cajaRepo: IWalletMovimientoRepository) {}

  /**
   * R18/R19/R20 — el egreso del pago a la tienda, en la `tx` que se le da.
   *
   * `origenTipo`/`origenId` apuntan AL DOCUMENTO del pago, no a la nada: es lo que le da la
   * idempotencia gratis (R21) y lo que permite que el backfill de la Tanda E use exactamente
   * esta misma clave sin duplicar nada.
   */
  async emitirEgresoDePago(
    tx: CajaPagoTiendaTxClient,
    movimiento: MovimientoDeCajaDePagoTienda,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_pago_tienda", // naturaleza TERCEROS: no toca la ganancia (R18)
        monto: movimiento.monto,
        origenTipo: "pago_tienda",
        origenId: movimiento.pagoId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        fechaMovimiento: movimiento.fechaMovimiento, // R20: la fecha REAL del pago
      },
    ]);
  }

  /**
   * R24/R25/R26 — el reverso de la anulacion, con la MISMA clave de origen que el egreso y otra
   * categoria.
   *
   * `ingreso_reverso_pago_tienda`, jamas `ingreso_ajuste`: el segundo es de naturaleza propia y
   * convertiria una correccion administrativa en ₡X de ganancia inventada (design §10-C).
   */
  async emitirReversoDeAnulacion(
    tx: CajaPagoTiendaTxClient,
    movimiento: MovimientoDeCajaDePagoTienda,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "ingreso",
        categoria: "ingreso_reverso_pago_tienda", // naturaleza TERCEROS (R26)
        monto: movimiento.monto,
        origenTipo: "pago_tienda", // el del PAGO: comparte clave con el egreso y solo cambia la categoria
        origenId: movimiento.pagoId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        fechaMovimiento: movimiento.fechaMovimiento, // R25: el dia de la ANULACION
      },
    ]);
  }
}
