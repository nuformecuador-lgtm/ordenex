// FICHA 410 (design §8) — LO QUE EL DRENADOR NECESITA SABER DE UN AVISO YA CREADO.
//
// POR QUE ES UNA INTERFAZ APARTE Y NO DOS METODOS MAS EN `INotificacionRepository`: aquella la
// implementan y la doblan una docena de sitios de la 146 —incluido el emisor TRANSACCIONAL, que la
// construye con un `tx` que solo expone dos tablas—, y estas dos consultas necesitan ademas
// `usuario`. Meterlas alli obligaria a ensanchar el cliente que TODOS reciben para que solo dos
// llamadas lo usen. Segregar es mas barato y deja el contrato del emisor donde estaba.
//
// DONDE VIVE EL PREDICADO: en `lib/repositories/NotificacionRepository.ts`, PEGADO a
// `predicadoVisibilidad`. Es el camino INVERSO del mismo criterio («dado un aviso, quien lo veria»)
// y tenerlos en archivos distintos es como acaban divergiendo. Ver `predicadoDestinatariosDeAviso`.
import type { RolValue } from "@prisma/client";
import type { NotificacionEvento } from "@/lib/types/notificacion";

/** La fila del aviso, con lo justo para componer su presentacion. Sin alcance y sin destinatario. */
export interface AvisoParaPush {
  readonly id: string;
  readonly evento: NotificacionEvento;
  readonly descripcion: string;
  readonly anexo: string | null;
}

/**
 * Un usuario que VERIA ese aviso en su campana.
 *
 * ⚠️ `rol` ES EL ROL DE QUIEN LEE, no la columna `destinatario_rol` de la fila. No son lo mismo:
 * `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres` llegan al mensajero como fila DIRIGIDA A
 * USUARIO, asi que su `destinatario_rol` es NULL — y es justo para el mensajero para quien esos dos
 * son elegibles. Confundirlos deja sin push exactamente a los dos avisos que mas lo merecen.
 */
export interface DestinatarioDeAviso {
  readonly usuarioId: string;
  readonly rol: RolValue;
  /** `usuario.zona_id`. Lo necesita el resolutor de la cifra viva para acotar al `adminSatelite`. */
  readonly zonaId: string | null;
}

export interface IPushNotificacionReader {
  /** La fila, o `null` si ya no existe. `null` TERMINA el trabajo sin enviar (R8). */
  leerAviso(notificacionId: string): Promise<AvisoParaPush | null>;

  /**
   * R21/R24/R25/R8 — los usuarios `activo` que verian ese aviso en su campana Y todavia NO lo han
   * leido ni descartado.
   *
   * El alcance sale del MISMO predicado que usa el listado (`predicadoVisibilidad`), leido del
   * reves. NO existe un segundo criterio: si hubiera dos, el push acabaria llegandole a alguien que
   * no ve el aviso, que es la peor version posible de este canal.
   */
  destinatariosPendientes(notificacionId: string): Promise<DestinatarioDeAviso[]>;
}
