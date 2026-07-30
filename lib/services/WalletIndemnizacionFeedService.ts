import { Prisma } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  IWalletIndemnizacionFeedService,
  WalletIndemnizacionFeedTxClient,
} from "@/lib/interfaces/services/IWalletIndemnizacionFeedService";

/**
 * Feature 158 (design §6.3, R26/R27) — construye el EGRESO de indemnizacion de un cierre
 * aprobado. Corre DENTRO de la transaccion de aprobacion (misma `tx` que los feeds 42/43/44) y
 * DESPUES de que los montos se hayan escrito en `gestion_orden.indemnizacion`.
 *
 * UN solo movimiento por cierre, agregando todas sus gestiones `incidente` — igual que el
 * `egreso_pago_mensajero = P` de la 44 (design §9.2). La trazabilidad POR ORDEN no se pierde:
 * vive en `gestion_orden.indemnizacion`, junto a la causa, el motivo y las evidencias que la
 * justifican.
 *
 * Money-safe: `Prisma.Decimal` de punta a punta, salida STRING escala 2. Nunca `number`,
 * nunca `parseFloat`.
 */
export class WalletIndemnizacionFeedService implements IWalletIndemnizacionFeedService {
  async construirEgresoIndemnizacion(
    cierreId: string,
    tx: WalletIndemnizacionFeedTxClient,
  ): Promise<CrearMovimientoInput[]> {
    // R26: el MISMO predicado con el que la aprobacion escribio los montos
    // (`{ cierreId, resultado: "incidente" }`). Una gestion anulada no puede estar aqui: el
    // `updateMany` que vincula al cierre exige `anuladaAt: null` (67/R16).
    const gestiones = await tx.gestionOrden.findMany({
      where: { cierreId, resultado: "incidente" },
      select: { indemnizacion: true },
    });

    let total = new Prisma.Decimal(0);
    for (const g of gestiones) {
      // Un monto AUSENTE (gestion `incidente` sin capturar) NO aporta — misma semantica que el
      // `SUM(indemnizacion)` de SQL, que ignora los NULL. No deberia ocurrir: la guardia de
      // cobertura EXACTA del service (R19) exige un monto por cada gestion `incidente` del
      // cierre, y el `updateMany` guardado del repo lanza si alguno no aplica. Si aun asi
      // llegara, el feed NO inventa un monto: prefiere emitir de MENOS antes que de mas.
      if (g.indemnizacion != null) total = total.plus(g.indemnizacion);
    }

    // R27: sin incidentes (o con la suma en 0) NO se emite fila — ni una en 0.00. Mismo
    // criterio que el feed de ingresos (que omite conceptos en 0.00) y que la 44 con P = 0.
    if (!total.gt(0)) return [];

    // R26: `origen_tipo = cierre_dia` + `origen_id = cierreId` -> el indice unico parcial
    // `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL` de la 42 da la
    // IDEMPOTENCIA: re-aprobar no emite un segundo egreso (R28).
    // `registradoPor` va `null` como en todos los movimientos automaticos; la autoria humana
    // queda en `cierre_dia.resuelto_por`/`resuelto_at` (38/R14).
    return [
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: total.toFixed(2),
        origenTipo: "cierre_dia",
        origenId: cierreId,
        descripcion: null,
        registradoPor: null,
      },
    ];
  }
}
