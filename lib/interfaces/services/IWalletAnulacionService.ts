import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CaminoAnulacion, DestinoMovimiento, MotivoNoAnulable } from "@/lib/types/wallet-anulacion";

/**
 * FICHA 458-B (design §4.2, R63/R65/R82) — a donde va una anulacion.
 *
 * `ruta` nombra el CAMINO que ya existe (o el nuevo) y el id que su action espera (`pagoId`,
 * `cobroId`, `movimientoId`, …). Nunca un monto: el camino lo lee del original.
 */
export type RutaAnulacion =
  | { status: "ruta"; camino: CaminoAnulacion; id: string }
  | { status: "no_encontrado" }
  | { status: "no_anulable"; motivo: MotivoNoAnulable }
  | { status: "forbidden" };

export interface IWalletAnulacionService {
  /**
   * R82 — rol (acceso total) ANTES de leer. Despues, la fila o el documento del destino y la
   * clasificacion de design §4.2: cada original a su camino; contra-asientos, lo que produce un
   * cierre y las salidas reclasificadas → `no_anulable` con su motivo (R65).
   */
  enrutar(destino: DestinoMovimiento, actor: Actor): Promise<RutaAnulacion>;
}
