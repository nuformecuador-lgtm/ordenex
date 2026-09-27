import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaCobroTiendaTxClient,
  ICajaCobroTiendaFeedService,
  MovimientoDeCajaDeCobroTienda,
} from "@/lib/interfaces/services/ICajaCobroTiendaFeedService";

/**
 * FICHA 461 (design §5.2) — las DOS escrituras de la caja del cobro de Ordenex a una tienda. Molde
 * exacto de `CajaPagoPorCuentaFeedService`: tipo, categoria y origen son LITERALES de esta clase.
 *
 * Las dos filas comparten la clave `(cobro_tienda, cobroId)` y se distinguen por la categoria, asi
 * que el indice unico parcial `wallet_movimiento_origen_categoria_uq` las hace idempotentes (R2): un
 * segundo intento de escribir la linea del mismo cobro es un no-op (`crearMovimientos` devuelve 0).
 *
 * El cargo es un ingreso PROPIO de liquidez «cargo» (HD1): sube la ganancia, baja «De las tiendas»
 * y no cuenta en «Entro». Su reverso es un egreso propio «cargo»: lo contrario, y no cuenta en
 * «Salio» (R22). Las dos clasificaciones viven en `lib/utils/caja-tesoreria.ts`.
 */
export class CajaCobroTiendaFeedService implements ICajaCobroTiendaFeedService {
  constructor(private readonly cajaRepo: IWalletMovimientoRepository) {}

  async emitirCargoDeCobro(
    tx: CajaCobroTiendaTxClient,
    movimiento: MovimientoDeCajaDeCobroTienda,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "ingreso",
        categoria: "ingreso_cobro_tienda", // PROPIO + CARGO: ganancia +M, «De las tiendas» −M, «Entro» 0
        monto: movimiento.monto,
        origenTipo: "cobro_tienda",
        origenId: movimiento.cobroId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        fechaMovimiento: movimiento.fechaMovimiento, // R3: el MISMO instante que el debito
      },
    ]);
  }

  async emitirReversoDeCobro(
    tx: CajaCobroTiendaTxClient,
    movimiento: MovimientoDeCajaDeCobroTienda,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_reverso_cobro_tienda", // PROPIO + CARGO: ganancia −M, «De las tiendas» +M, «Salio» 0
        monto: movimiento.monto,
        origenTipo: "cobro_tienda", // la MISMA clave que el cargo: se distinguen por la categoria
        origenId: movimiento.cobroId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        fechaMovimiento: movimiento.fechaMovimiento, // R11: el MISMO instante que el credito de la tienda
      },
    ]);
  }
}
