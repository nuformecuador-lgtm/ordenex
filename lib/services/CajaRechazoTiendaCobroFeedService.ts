import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaRechazoTiendaCobroTxClient,
  ICajaRechazoTiendaCobroFeedService,
  ReversosDeCobroRechazo,
} from "@/lib/interfaces/services/ICajaRechazoTiendaCobroFeedService";

/**
 * FICHA 458-B (design §2.3/§4.2, D7) — los DOS reversos de cargo de la anulacion de un cobro por
 * rechazo. Molde exacto de `CajaCobroTiendaFeedService.emitirReversoDeCobro`: tipo, categoria y
 * origen son LITERALES de esta clase.
 *
 * Cada reverso es un egreso PROPIO de liquidez «cargo» (`lib/utils/caja-tesoreria.ts`): baja la
 * ganancia, SUBE «De las tiendas» y no cuenta en «Salio» (no sale dinero: se deshace un cargo). Van
 * con la MISMA clave que su ingreso original (`gestion_orden`, gestion) y se distinguen por la
 * categoria, asi que `wallet_movimiento_origen_categoria_uq` los hace idempotentes.
 */
export class CajaRechazoTiendaCobroFeedService implements ICajaRechazoTiendaCobroFeedService {
  constructor(private readonly cajaRepo: Pick<IWalletMovimientoRepository, "crearMovimientos">) {}

  async emitirReversosDeAnulacion(
    tx: CajaRechazoTiendaCobroTxClient,
    r: ReversosDeCobroRechazo,
  ): Promise<number> {
    const base = {
      tipo: "egreso" as const,
      origenTipo: "gestion_orden" as const,
      origenId: r.gestionId,
      descripcion: r.descripcion,
      registradoPor: r.registradoPor,
      fechaMovimiento: r.fechaMovimiento,
    };
    const movs: CrearMovimientoInput[] = [];
    if (r.montoFlete !== null) {
      // PROPIO + CARGO: ganancia −M, «De las tiendas» +M, «Salio» 0.
      movs.push({ ...base, categoria: "egreso_reverso_flete_devolucion", monto: r.montoFlete });
    }
    if (r.montoIva !== null) {
      movs.push({ ...base, categoria: "egreso_reverso_iva_flete_devolucion", monto: r.montoIva });
    }
    if (movs.length === 0) return 0;
    return this.cajaRepo.crearMovimientos(tx, movs);
  }
}
