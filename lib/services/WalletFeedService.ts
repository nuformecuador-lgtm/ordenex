import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService, WalletFeedTxClient } from "@/lib/interfaces/services/IWalletFeedService";
import {
  agregarIngresosPorConcepto,
  type OrdenIngresoInput,
} from "@/lib/utils/ingreso-ordenex";

/**
 * Feature 42 (design §2.2) — construye los movimientos de INGRESO de un cierre aprobado.
 * Se ejecuta DENTRO de la transaccion de aprobacion: lee TODAS las gestiones del cierre en
 * la misma `tx`, resuelve la tarifa vigente por zona (cacheada por zonaId para no
 * re-consultar), usa el util puro (derivar + agregar por concepto) y devuelve las filas a
 * insertar (origen = cierre_dia), OMITIENDO conceptos con total 0.00 (R10). NO persiste; el
 * repo las inserta idempotentemente en la tx (design §2.2). Money-safe: montos STRING.
 */
export class WalletFeedService implements IWalletFeedService {
  constructor(private readonly tarifaRepo: ITarifaVigentePorTiendaRepository) {}

  async construirMovimientosDeIngreso(
    cierreId: string,
    tx: WalletFeedTxClient,
  ): Promise<CrearMovimientoInput[]> {
    // R5: TODAS las gestiones del cierre, con la orden (tiendaId, montoCobrar, cobraComision)
    // y su zona (esCentral). Money-safe: montoCobrar se lee como Decimal -> STRING.
    const gestiones = await tx.gestionOrden.findMany({
      where: { cierreId },
      select: {
        resultado: true,
        orden: {
          select: {
            tiendaId: true, // feature 69/R20: la tarifa se resuelve por TIENDA
            montoCobrar: true,
            cobraComision: true,
            zona: { select: { esCentral: true } },
          },
        },
      },
    });

    // Cache de tarifa por tiendaId: una tienda se resuelve una sola vez por cierre (R9: null
    // si no hay tarifa vigente -> conceptos 0.00, no bloquea).
    const cacheTarifa = new Map<string, TarifaVigente | null>();
    const resolverTarifa = async (tiendaId: string): Promise<TarifaVigente | null> => {
      if (cacheTarifa.has(tiendaId)) return cacheTarifa.get(tiendaId) ?? null;
      const t = await this.tarifaRepo.resolveTarifaPorTienda(tiendaId);
      cacheTarifa.set(tiendaId, t);
      return t;
    };

    const entradas: Array<{ input: OrdenIngresoInput; tarifa: TarifaVigente | null }> = [];
    for (const g of gestiones) {
      const tarifa = await resolverTarifa(g.orden.tiendaId);
      entradas.push({
        input: {
          resultado: g.resultado,
          esCentral: g.orden.zona.esCentral,
          montoCobrar: g.orden.montoCobrar === null ? null : g.orden.montoCobrar.toFixed(2),
          cobraComision: g.orden.cobraComision,
        },
        tarifa,
      });
    }

    // R10: 1 movimiento por concepto agregado, omitiendo los que quedan en 0.00.
    const conceptos = agregarIngresosPorConcepto(entradas);
    return conceptos.map((c) => ({
      tipo: "ingreso" as const,
      categoria: c.categoria,
      monto: c.monto,
      origenTipo: "cierre_dia" as const,
      origenId: cierreId,
      descripcion: null,
      registradoPor: null,
    }));
  }
}
