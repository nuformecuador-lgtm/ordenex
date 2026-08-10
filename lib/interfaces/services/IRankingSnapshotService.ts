import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RankingSnapshotData } from "@/lib/types/ranking-snapshot";

// Feature 196 (design §4.1) — contrato del servicio del snapshot diario. No conoce HTTP ni
// Prisma: recibe los repos por inyeccion y el instante por parametro. Resultados de dominio
// como union discriminada; el borde (route handler del cron / Server Action) los traduce.

/** R12 — `omitido` NO es un error: la fecha ya estaba congelada y no se toco nada. */
export type CongelarResult =
  | { status: "creado"; fecha: string; filas: number }
  | { status: "omitido"; fecha: string; filas: number };

export type ObtenerSnapshotResult =
  /** `data.filas` vacio = ese dia no hubo actividad (la cabecera SI existe). */
  | { status: "ok"; data: RankingSnapshotData }
  /** R26 — no hay cabecera de esa fecha: el cron no corrio (incluye todo lo anterior al despliegue). */
  | { status: "sin_snapshot"; fecha: string }
  /** R27 — rol sin permiso de lectura: ni un dato del historico sale de aqui. */
  | { status: "forbidden" };

export interface IRankingSnapshotService {
  /**
   * R2/R15 — congela la fecha CR D−1 respecto de `now`, y ninguna otra. **NO recibe la fecha
   * por parametro y no debe recibirla nunca**: sin firma que permita pedir otra fecha, el
   * backfill —descartado por la decision humana 3— no entra por la puerta de atras. `now` es
   * obligatorio (sin default): un reloj por defecto deja creer a un test que controla el
   * tiempo cuando no lo hace.
   *
   * R3 — mismo universo, mismas magnitudes, mismo umbral y misma regla de podio que el
   * ranking en vivo. R5 — solo produce fila el mensajero CON actividad. R11 — un dia sin
   * actividad escribe igualmente la cabecera, con `filas = 0`.
   */
  congelar(now: Date): Promise<CongelarResult>;
  /**
   * R25/R26/R27/R28 — el historico completo de una fecha en el ORDEN CONGELADO. Autoriza
   * exactamente como el ranking en vivo: acceso total (`maestro`/`admin`) y `mensajero`
   * —este ultimo ve TODAS las filas, sin recorte a las suyas (decision humana 4)—; cualquier
   * otro rol, `forbidden`. Es SOLO LECTURA: no existe metodo de escritura en este contrato
   * fuera de `congelar` (R29).
   *
   * `fecha` es `"YYYY-MM-DD"` ya validada en el borde (R30).
   */
  obtenerPorFecha(actor: Actor, fecha: string): Promise<ObtenerSnapshotResult>;
}
