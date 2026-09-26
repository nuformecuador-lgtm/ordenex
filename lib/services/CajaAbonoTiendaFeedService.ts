import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaAbonoTiendaTxClient,
  ICajaAbonoTiendaFeedService,
  MovimientoDeCajaDeAbono,
} from "@/lib/interfaces/services/ICajaAbonoTiendaFeedService";

/**
 * FICHA 457 (design §6.1) — las DOS escrituras de la caja del pago de una tienda a Ordenex. Molde
 * exacto de `CajaPagoPorCuentaFeedService`: tipo, categoria y origen son LITERALES de esta clase.
 *
 * Las dos filas comparten la clave `(abono_tienda, abonoId)` y se distinguen por la categoria, asi que
 * el indice unico parcial `(origen_tipo, origen_id, categoria)` las hace idempotentes: un segundo
 * intento es un no-op (`crearMovimientos` devuelve 0).
 */
export class CajaAbonoTiendaFeedService implements ICajaAbonoTiendaFeedService {
  constructor(private readonly cajaRepo: IWalletMovimientoRepository) {}

  async emitirIngresoDeAbono(
    tx: CajaAbonoTiendaTxClient,
    movimiento: MovimientoDeCajaDeAbono,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "ingreso",
        categoria: "ingreso_abono_tienda", // TERCEROS, EFECTIVO: sube «Entro» y «De las tiendas», no la ganancia (DH1)
        monto: movimiento.monto,
        origenTipo: "abono_tienda",
        origenId: movimiento.abonoId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        fechaMovimiento: movimiento.fechaMovimiento,
      },
    ]);
  }

  async emitirReversoDeAbono(
    tx: CajaAbonoTiendaTxClient,
    movimiento: MovimientoDeCajaDeAbono,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_reverso_abono_tienda", // TERCEROS, EFECTIVO: el dinero vuelve a salir; la tienda vuelve a deber
        monto: movimiento.monto,
        origenTipo: "abono_tienda", // el del DOCUMENTO: la misma clave que la entrada
        origenId: movimiento.abonoId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        fechaMovimiento: movimiento.fechaMovimiento,
      },
    ]);
  }
}
