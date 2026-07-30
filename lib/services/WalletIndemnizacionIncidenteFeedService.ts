import { Prisma } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  IWalletIndemnizacionIncidenteFeedService,
  WalletIndemnizacionIncidenteFeedTxClient,
} from "@/lib/interfaces/services/IWalletIndemnizacionIncidenteFeedService";

/**
 * Feature 158 (design §12.5, R52/R53) — construye el EGRESO de indemnizacion de un incidente
 * del ADMIN recien aprobado. Corre DENTRO de la transaccion de aprobacion y DESPUES de que el
 * monto se haya escrito en `orden_incidente.indemnizacion`.
 *
 * UN movimiento por incidente. A diferencia del feed del cierre (que AGREGA todas las gestiones
 * `incidente` de un cierre en una sola fila), aqui el grano natural ya es uno: un incidente =
 * una aprobacion = un egreso. Por eso `origen_id` es el id del incidente y la idempotencia del
 * indice unico parcial `(origen_tipo, origen_id, categoria)` de la 42 da exactamente lo que R53
 * pide: reintentar la aprobacion NO emite un segundo movimiento.
 *
 * Money-safe: `Prisma.Decimal` de punta a punta, salida STRING escala 2. Nunca `number`, nunca
 * `parseFloat`.
 */
export class WalletIndemnizacionIncidenteFeedService
  implements IWalletIndemnizacionIncidenteFeedService
{
  async construirEgresoIndemnizacionIncidente(
    incidenteId: string,
    tx: WalletIndemnizacionIncidenteFeedTxClient,
  ): Promise<CrearMovimientoInput[]> {
    // R52: se LEE lo que la misma `tx` acaba de escribir, con `estado: "aprobado"` en el WHERE
    // como GUARDIA (no como filtro cosmetico): un incidente `solicitado` o `rechazado` no puede
    // producir dinero por esta via ni aunque alguien invocara el feed con su id.
    const incidente = await tx.ordenIncidente.findFirst({
      where: { id: incidenteId, estado: "aprobado" },
      select: { indemnizacion: true },
    });

    // Sin fila (no existe, o no esta aprobado) -> nada que emitir.
    if (incidente === null || incidente.indemnizacion == null) return [];

    const monto = new Prisma.Decimal(incidente.indemnizacion);
    // No se emite una fila en 0.00 ni negativa. El borde ya exige `> 0` (R50); esto es la
    // defensa de ultima linea, con el fallo del lado seguro: emitir de MENOS antes que de mas.
    if (!monto.gt(0)) return [];

    // R52: `origen_tipo = orden_incidente` (valor PROPIO, R37) + `origen_id = incidenteId`.
    // `registradoPor` va `null` como en todos los movimientos automaticos; la autoria humana
    // queda en `orden_incidente.resuelto_por`/`resuelto_at` (mismo criterio que 38/R14).
    return [
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: monto.toFixed(2),
        origenTipo: "orden_incidente",
        origenId: incidenteId,
        descripcion: null,
        registradoPor: null,
      },
    ];
  }
}
