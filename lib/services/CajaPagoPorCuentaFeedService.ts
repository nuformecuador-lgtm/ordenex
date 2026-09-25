import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaPagoPorCuentaTxClient,
  ICajaPagoPorCuentaFeedService,
  MovimientoDeCajaDePagoPorCuenta,
} from "@/lib/interfaces/services/ICajaPagoPorCuentaFeedService";

/**
 * FICHA 459 (design §6.3) — las DOS escrituras de la caja del pago por cuenta de una tienda. Molde
 * exacto de `CajaPagoTiendaFeedService`: tipo, categoria y origen son LITERALES de esta clase.
 *
 * Las dos filas comparten la clave `(pago_por_cuenta_tienda, pagoId)` y se distinguen por la
 * categoria, asi que el indice unico parcial `(origen_tipo, origen_id, categoria)` las hace
 * idempotentes: un segundo intento es un no-op (`crearMovimientos` devuelve 0).
 */
export class CajaPagoPorCuentaFeedService implements ICajaPagoPorCuentaFeedService {
  constructor(private readonly cajaRepo: IWalletMovimientoRepository) {}

  async emitirEgresoDePagoPorCuenta(
    tx: CajaPagoPorCuentaTxClient,
    movimiento: MovimientoDeCajaDePagoPorCuenta,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_pago_por_cuenta_tienda", // TERCEROS: baja «De las tiendas», no la ganancia
        monto: movimiento.monto,
        origenTipo: "pago_por_cuenta_tienda",
        origenId: movimiento.pagoId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        ...(movimiento.fechaMovimiento !== undefined
          ? { fechaMovimiento: movimiento.fechaMovimiento }
          : {}),
      },
    ]);
  }

  async emitirReversoDePagoPorCuenta(
    tx: CajaPagoPorCuentaTxClient,
    movimiento: MovimientoDeCajaDePagoPorCuenta,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "ingreso",
        categoria: "ingreso_reverso_pago_por_cuenta_tienda", // TERCEROS: el dinero vuelve
        monto: movimiento.monto,
        origenTipo: "pago_por_cuenta_tienda", // el del DOCUMENTO: la misma clave que la salida
        origenId: movimiento.pagoId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        ...(movimiento.fechaMovimiento !== undefined
          ? { fechaMovimiento: movimiento.fechaMovimiento }
          : {}),
      },
    ]);
  }
}
