import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService, WalletFeedTxClient } from "@/lib/interfaces/services/IWalletFeedService";
import {
  detalleDe,
  leerDetallePorOrden,
  tarifaDe,
} from "@/lib/utils/cierre-detalle";
import {
  agregarIngresosPorConcepto,
  type OrdenIngresoInput,
} from "@/lib/utils/ingreso-ordenex";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

/**
 * Feature 42 (design §2.2) — construye los movimientos de INGRESO de un cierre aprobado.
 * Se ejecuta DENTRO de la transaccion de aprobacion y devuelve las filas a insertar (origen =
 * cierre_dia), OMITIENDO conceptos con total 0.00 (R10). NO persiste; el repo las inserta
 * idempotentemente en la tx. Money-safe: montos STRING.
 *
 * Feature 69 (R12/R14/R21) — EL CAMBIO MONEY-CRITICAL: deriva desde el SNAPSHOT
 * (`cierre_detail`) y NO lee `orden`, `zona` ni `tarifas` VIVAS. Antes leia
 * `g.orden.{montoCobrar, cobraComision, zona.esCentral}` y resolvia la tarifa VIGENTE aqui
 * mismo, dentro de la tx de aprobacion: editar la orden o cambiar la tarifa entre SOLICITAR y
 * APROBAR descuadraba en silencio los `total_*` del cierre (37/R14) contra los movimientos, en
 * un libro append-only. Ahora el cierre no PREGUNTA: RECUERDA lo que habia al solicitarse.
 *
 * Por eso el service ya NO recibe el resolver de tarifa ni cachea por tienda: la tarifa viene
 * congelada POR FILA. La FORMULA no cambia (`agregarIngresosPorConcepto`/`derivarIngresoOrden`
 * intactos, R21): mismas entradas, misma salida, distinta PROCEDENCIA.
 */
export class WalletFeedService implements IWalletFeedService {
  async construirMovimientosDeIngreso(
    cierreId: string,
    tx: WalletFeedTxClient,
  ): Promise<CrearMovimientoInput[]> {
    // El GRANO se respeta: `cierre_detail` aporta lo de la ORDEN (congelado) y `gestion_orden`
    // el `resultado`, que es de la GESTION. Una orden con 2 gestiones vigentes en el cierre
    // aporta 2 entradas que comparten la misma fila congelada (design §4.1).
    const [byOrden, gestiones] = await Promise.all([
      leerDetallePorOrden(cierreId, tx),
      tx.gestionOrden.findMany({
        where: { cierreId },
        select: { ordenId: true, resultado: true },
      }),
    ]);

    const entradas: Array<{ input: OrdenIngresoInput; tarifa: TarifaVigente | null }> = [];
    for (const g of gestiones) {
      // R14: sin fallback a datos vivos. El backfill (R26/R27) garantiza que la fila existe;
      // si falta, la aprobacion ABORTA en vez de descuadrar en silencio.
      const d = detalleDe(byOrden, cierreId, g.ordenId);
      entradas.push({
        input: {
          resultado: g.resultado,
          esCentral: d.esCentral, // el flag de la zona AL SOLICITAR (elige la columna GAM, R21)
          // La marca del DISTRITO AL SOLICITAR: elige el pacto especial si la tarifa lo trae.
          esZonaEspecial: d.esZonaEspecial,
          // Money-safe: Decimal -> STRING escala 2, nunca number (R11).
          montoCobrar: d.montoCobrar === null ? null : d.montoCobrar.toFixed(2),
          cobraComision: d.cobraComision,
        },
        // R9 preservado: `tarifa_id` NULL -> null -> conceptos 0.00, sin bloquear.
        tarifa: tarifaDe(d),
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
