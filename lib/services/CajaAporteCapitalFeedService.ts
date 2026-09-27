import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaAporteCapitalTxClient,
  ICajaAporteCapitalFeedService,
  MovimientoDeCajaDeCapital,
} from "@/lib/interfaces/services/ICajaAporteCapitalFeedService";

/**
 * FICHA 459 (design §6.3) — las DOS escrituras de la caja del saldo inicial o aporte de capital.
 * Tipo, categoria y origen son LITERALES de esta clase (molde `CajaPagoTiendaFeedService`). Las dos
 * filas comparten la clave `(aporte_capital, aporteId)` y se distinguen por la categoria.
 */
export class CajaAporteCapitalFeedService implements ICajaAporteCapitalFeedService {
  constructor(private readonly cajaRepo: IWalletMovimientoRepository) {}

  async emitirIngresoDeCapital(
    tx: CajaAporteCapitalTxClient,
    movimiento: MovimientoDeCajaDeCapital,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "ingreso",
        categoria: "ingreso_aporte_capital", // CAPITAL: no es ganancia ni dinero de las tiendas
        monto: movimiento.monto,
        origenTipo: "aporte_capital",
        origenId: movimiento.aporteId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        ...(movimiento.fechaMovimiento !== undefined
          ? { fechaMovimiento: movimiento.fechaMovimiento }
          : {}),
      },
    ]);
  }

  async emitirReversoDeCapital(
    tx: CajaAporteCapitalTxClient,
    movimiento: MovimientoDeCajaDeCapital,
  ): Promise<number> {
    return this.cajaRepo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_reverso_aporte_capital", // CAPITAL
        monto: movimiento.monto,
        origenTipo: "aporte_capital",
        origenId: movimiento.aporteId,
        descripcion: movimiento.descripcion,
        registradoPor: movimiento.registradoPor,
        ...(movimiento.fechaMovimiento !== undefined
          ? { fechaMovimiento: movimiento.fechaMovimiento }
          : {}),
      },
    ]);
  }
}
