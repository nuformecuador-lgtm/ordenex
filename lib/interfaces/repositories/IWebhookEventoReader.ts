// FICHA 454 (design §12.1, T1.5) — lectura MINIMA que el handler de `webhook_evento` necesita para
// armar el cuerpo de UN hecho de orden. Solo lectura, separado de `IOrdenRepository` (patron
// `IWebhookOrdenReader` de la 99).
import type { GestionResultado, RolValue } from "@prisma/client";

import type { ApiMensajeroDTO } from "@/lib/types/api-orden";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { OrdenEventoTipo } from "@/lib/types/orden-evento";

export interface DatosEntregaEvento {
  ordenEventoId: string;
  tipo: OrdenEventoTipo;
  /** Instante del hecho: es el `ocurridoAt` del cuerpo. */
  createdAt: Date;
  /** El rol del actor, CONGELADO en la fila: decide `via` en `orden.ayuda_resuelta`. */
  actorRol: RolValue;
  /** Snapshot del evento: el registrado (registrada) o el nuevo (corregida). */
  resultado: GestionResultado | null;
  resultadoAnterior: GestionResultado | null;
  gestionId: string | null;
  /**
   * Causa TIPIFICADA de la gestion del evento (la de devolucion si es `devuelta`, la de incidente si
   * es `incidente`); `null` si no aplica. NUNCA el texto libre (`gestion_orden.motivo`) ni el
   * `orden_evento.motivo` (que en una correccion lleva la frase del admin): 256/R22.
   */
  causa: CausaDevolucion | CausaIncidente | null;
  /** El mensajero asignado EN EL INSTANTE DEL HECHO (congelado en el evento), o `null`. */
  mensajero: ApiMensajeroDTO | null;
  orden: {
    /** Dueño de la orden = destino del webhook. SIEMPRE de aqui, nunca del payload. */
    tiendaId: string;
    numGuia: number | null;
    numRemision: string;
    deletedAt: Date | null;
  };
}

export interface IWebhookEventoReader {
  /** `null` si el evento no existe (job completado sin entregar). */
  findDatosEntrega(ordenEventoId: string): Promise<DatosEntregaEvento | null>;
}
