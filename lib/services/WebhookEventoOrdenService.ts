// FICHA 454 (design §12.1, T1.5; R33) — servicio que resuelve UN job `webhook_evento`: entrega
// firmada de UN hecho de orden (gestion registrada/anulada/corregida, ayuda solicitada/resuelta) a
// la suscripcion del dueño de la orden. Hermano de `WebhookEstadoService`.
//
// REUSA, no copia: el sender (`IWebhookSender`), la firma (`cabecerasFirma`), el descifrado del
// secreto, la resolucion de la suscripcion (`IWebhookSuscripcionRepository`), el predicado del
// circuito (`estaPausada` + `pausaConfigDe`, 403) y el error de entrega que la cola sabe leer
// (`WebhookEntregaFallidaError`, con su `retryAfterMs`). Mismo contrato de cola: retornar =
// `complete`; lanzar = backoff y, agotados los intentos, dead-letter.
//
// SEGURIDAD/PRIVACIDAD (99/R29): nunca se loguea el secreto, la URL ni datos del destinatario.
import { z } from "zod";

import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type {
  DatosEntregaEvento,
  IWebhookEventoReader,
} from "@/lib/interfaces/repositories/IWebhookEventoReader";
import type { IWebhookSender } from "@/lib/interfaces/external/IWebhookSender";
import type { WebhookConfig } from "@/lib/config/webhook";
import { pausaConfigDe } from "@/lib/config/webhook";
import { descifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { cabecerasFirma } from "@/lib/crypto/webhook-firma";
import { estaPausada } from "@/lib/utils/webhook-suscripcion-pausa";
import {
  notificadorNoOp,
  type WebhookSuscripcionPausadaNotificador,
} from "@/lib/notificaciones/notificadores";
import { WebhookEntregaFallidaError } from "@/lib/services/WebhookEstadoService";
import { dedupeKeyWebhookEvento } from "@/lib/services/jobs/webhook-evento-encolado";
import type { ApiMensajeroDTO } from "@/lib/types/api-orden";
import type { OrdenEventoTipo } from "@/lib/types/orden-evento";

/**
 * Nombre PUBLICO del evento por tipo de hecho (design §12.1, DC). Los dos tipos de vuelta de la
 * ayuda publican el MISMO evento (`orden.ayuda_resuelta`) y se distinguen por `data.via`.
 * `Record` exhaustivo: un tipo nuevo en el SEED no compila sin decidir su nombre publico.
 */
export const EVENTO_PUBLICO_POR_TIPO: Record<OrdenEventoTipo, string> = {
  gestion_registrada: "orden.gestion_registrada",
  gestion_anulada: "orden.gestion_anulada",
  gestion_corregida: "orden.gestion_corregida",
  ayuda_solicitada: "orden.ayuda_solicitada",
  ayuda_rescatada: "orden.ayuda_resuelta",
  ayuda_habilitada_api: "orden.ayuda_resuelta",
};

/** Por donde se resolvio la ayuda (`orden.ayuda_resuelta`). */
export type ViaAyuda = "mensajero" | "tienda" | "api";

interface DataEvento {
  numGuia: number | null;
  numRemision: string;
  gestionId?: string;
  resultado?: string;
  resultadoAnterior?: string;
  motivo: string | null;
  mensajero: ApiMensajeroDTO | null;
  pendienteConfirmacion?: boolean;
  via?: ViaAyuda;
}

const payloadSchema = z.object({ ordenEventoId: z.string().min(1) });

export interface WebhookEventoLogger {
  warn(message: string): void;
}
const defaultLogger: WebhookEventoLogger = { warn: () => {} };

export class WebhookEventoOrdenService {
  constructor(
    private readonly eventos: IWebhookEventoReader,
    private readonly suscripciones: IWebhookSuscripcionRepository,
    private readonly sender: IWebhookSender,
    private readonly config: WebhookConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: WebhookEventoLogger = defaultLogger,
    /** FICHA 403: aviso de suscripcion pausada. DEFAULT NO-OP (dobles de test). El real lo pasa el handler. */
    private readonly notificarPausa: WebhookSuscripcionPausadaNotificador = notificadorNoOp,
  ) {}

  async ejecutar(job: JobDTO): Promise<void> {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error("webhook_evento: payload invalido (se esperaba { ordenEventoId })");
    }
    const datos = await this.eventos.findDatosEntrega(parsed.data.ordenEventoId);
    // Evento inexistente u orden borrada -> completado sin entregar (99/R22).
    if (datos === null || datos.orden.deletedAt !== null) return;

    // Destino SIEMPRE por el dueño de la orden (99/R21/R24). Sin suscripcion activa -> completado.
    const sub = await this.suscripciones.findActivaByOwner(datos.orden.tiendaId);
    if (sub === null) return;

    const secret = descifrarSecreto(this.config.WEBHOOK_SECRET_ENC_KEY, sub.secret);
    // Idempotencia (99/R23): el `eventoId` es la `dedupeKey` y el cuerpo solo depende de la fila
    // append-only del evento, asi que reejecutar produce el MISMO id y el MISMO cuerpo.
    const cuerpo = JSON.stringify({
      evento: EVENTO_PUBLICO_POR_TIPO[datos.tipo],
      eventoId: dedupeKeyWebhookEvento(datos.ordenEventoId),
      ocurridoAt: datos.createdAt.toISOString(),
      data: armarData(datos),
    });
    const headers = cabecerasFirma(secret, Math.floor(this.now().getTime() / 1000), cuerpo);

    const outcome = await this.sender.entregar(sub.url, cuerpo, headers);
    if (outcome.status === "ok") {
      await this.suscripciones.registrarEntregaOk(datos.orden.tiendaId, this.now());
      return;
    }

    this.logger.warn("[webhook_evento] entrega fallida (transitorio)");
    // El circuito de la 403, con las MISMAS piezas que `WebhookEstadoService`: la racha es de la
    // SUSCRIPCION, no del tipo de job, asi que un fallo aqui cuenta igual que uno de estado.
    let retryAfterMs = outcome.retryAfterMs;
    const ahora = this.now();
    const estado = await this.suscripciones.incrementarFalloYLeer(datos.orden.tiendaId, ahora);
    if (
      estado !== null &&
      estaPausada(estado.fallosConsecutivos, estado.sinExitoDesde, ahora, pausaConfigDe(this.config))
    ) {
      await this.notificarPausa({ ownerUsuarioId: datos.orden.tiendaId, sinExitoDesde: estado.sinExitoDesde });
      retryAfterMs = this.config.WEBHOOK_PAUSA_INTERVALO_MS;
    }
    throw new WebhookEntregaFallidaError(outcome.detalle, retryAfterMs);
  }
}

/**
 * El `data` del cuerpo. ORDEN DE INSERCION FIJO (la firma se calcula sobre el string serializado).
 * Siempre presentes: `numGuia`, `numRemision`, `motivo` y `mensajero` (convenciones 256/404).
 * Opcionales segun el tipo. `motivo` es la causa TIPIFICADA de la gestion, jamas texto libre.
 */
export function armarData(d: DatosEntregaEvento): DataEvento {
  const data: DataEvento = { numGuia: d.orden.numGuia, numRemision: d.orden.numRemision, motivo: null, mensajero: null };
  const esGestion = d.tipo === "gestion_registrada" || d.tipo === "gestion_anulada" || d.tipo === "gestion_corregida";
  if (esGestion) {
    if (d.gestionId !== null) data.gestionId = d.gestionId;
    if (d.resultado !== null) data.resultado = d.resultado;
    if (d.tipo === "gestion_corregida" && d.resultadoAnterior !== null) data.resultadoAnterior = d.resultadoAnterior;
  }
  data.motivo = esGestion ? d.causa : null;
  data.mensajero = d.mensajero;
  // La gestion registrada y la corregida estan, por construccion, PENDIENTES de confirmar en el
  // instante del hecho (el estado se aplica al aprobar el cierre, R7).
  if (d.tipo === "gestion_registrada" || d.tipo === "gestion_corregida") data.pendienteConfirmacion = true;
  if (d.tipo === "ayuda_rescatada" || d.tipo === "ayuda_habilitada_api") data.via = viaDe(d);
  // Reordena para que el orden de claves no dependa de la rama: el de la interfaz.
  return {
    numGuia: data.numGuia,
    numRemision: data.numRemision,
    ...(data.gestionId !== undefined ? { gestionId: data.gestionId } : {}),
    ...(data.resultado !== undefined ? { resultado: data.resultado } : {}),
    ...(data.resultadoAnterior !== undefined ? { resultadoAnterior: data.resultadoAnterior } : {}),
    motivo: data.motivo,
    mensajero: data.mensajero,
    ...(data.pendienteConfirmacion !== undefined ? { pendienteConfirmacion: data.pendienteConfirmacion } : {}),
    ...(data.via !== undefined ? { via: data.via } : {}),
  };
}

function viaDe(d: DatosEntregaEvento): ViaAyuda {
  if (d.tipo === "ayuda_habilitada_api") return "api";
  return d.actorRol === "mensajero" ? "mensajero" : "tienda";
}
