// Feature 99 (design §7) — servicio que resuelve UN job `webhook_estado`. DI por INTERFACES
// (docs/architecture.md §Service): no conoce Next.js, ni Prisma, ni `fetch`.
//
// SEGURIDAD/PRIVACIDAD (R29): este archivo NUNCA emite por el logger el secreto de firma, la
// URL de callback ni datos del destinatario; los mensajes son agregados y citan solo la
// operacion. El secreto se descifra en memoria justo para firmar y no se loguea jamas (R32).
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookOrdenReader } from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { IWebhookSender } from "@/lib/interfaces/external/IWebhookSender";
import type { WebhookConfig } from "@/lib/config/webhook";
import { descifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { cabecerasFirma } from "@/lib/crypto/webhook-firma";
import { dedupeKeyWebhookEstado } from "@/lib/services/jobs/webhook-estado-encolado";

/** Nombre del evento del cuerpo de entrega (D3). */
export const EVENTO_ESTADO = "orden.estado_actualizado";

/** R30: el payload solo lleva estos tres campos. Cualquier otra forma es un error. */
const payloadSchema = z.object({
  ordenId: z.string().min(1),
  estatusDestinoId: z.string().min(1),
  ocurridoAt: z.string().min(1),
});

/** Logger inyectable, patron `JobsLogger` de la 90. NUNCA recibe PII ni secretos (R29). */
export interface WebhookEstadoLogger {
  warn(message: string): void;
}
const defaultLogger: WebhookEstadoLogger = { warn: () => {} };

/**
 * R20/R31: fallo RECUPERABLE de la entrega (no-2xx | timeout | red). El `detalle` viaja en el
 * mensaje para que `JobQueueService.fail` lo escriba en `jobs.last_error` (consultable). El
 * `detalle` proviene del sender y NUNCA incluye la URL, el cuerpo ni el secreto (R29).
 */
export class WebhookEntregaFallidaError extends Error {
  constructor(detalle: string) {
    super(detalle);
    this.name = "WebhookEntregaFallidaError";
  }
}

export class WebhookEstadoService {
  constructor(
    private readonly ordenes: IWebhookOrdenReader,
    private readonly suscripciones: IWebhookSuscripcionRepository,
    private readonly sender: IWebhookSender,
    private readonly config: WebhookConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: WebhookEstadoLogger = defaultLogger,
  ) {}

  /**
   * Desenlace = contrato de la cola: retornar = `complete`; lanzar = backoff y, agotados los
   * intentos, dead-letter (design §7).
   */
  async ejecutar(job: JobDTO): Promise<void> {
    // R30: forma inesperada del payload -> error de integracion (sin secreto).
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error(
        "webhook_estado: payload invalido (se esperaba { ordenId, estatusDestinoId, ocurridoAt })",
      );
    }
    const { ordenId, estatusDestinoId, ocurridoAt } = parsed.data;

    // R22: orden inexistente o borrada -> job COMPLETADO sin error.
    const datos = await this.ordenes.findDatosEntrega(ordenId, estatusDestinoId);
    if (datos === null || datos.deletedAt !== null) return;

    // R21/R24: destino SIEMPRE por `orden.tiendaId` (owner de la orden), nunca por el
    // payload. Sin suscripcion activa -> job completado sin entregar.
    const sub = await this.suscripciones.findActivaByOwner(datos.tiendaId);
    if (sub === null) return;

    // R32: descifra el secreto en memoria. Clave ausente o authTag invalido ->
    // `WebhookSecretKeyError` RECUPERABLE -> se propaga -> backoff. El secreto no se loguea.
    const secret = descifrarSecreto(this.config.WEBHOOK_SECRET_ENC_KEY, sub.secret);

    // R23: `eventoId` estable = la `dedupeKey`, determinista por (ordenId, estatusDestinoId,
    // ocurridoAt); reejecutar produce el MISMO id y el MISMO cuerpo. El consumidor deduplica.
    const eventoId = dedupeKeyWebhookEstado(ordenId, estatusDestinoId, ocurridoAt);
    const cuerpo = JSON.stringify({
      evento: EVENTO_ESTADO,
      eventoId,
      ocurridoAt,
      data: {
        numGuia: datos.numGuia,
        numRemision: datos.numRemision,
        estado: datos.estado,
        // Feature 256 (R1-R7). ⚠️ DOS `motivo` DISTINTOS QUE COMPARTEN NOMBRE, y esta es la UNICA
        // linea donde el nombre publico se pega al dato: `data.motivo` transporta la causa
        // TIPIFICADA de la devolucion (enum cerrado de 3 valores,
        // `gestion_orden.causa_devolucion`, `db/schema.prisma:823`) y NO es `gestion_orden.motivo`
        // (`db/schema.prisma:814`), el TEXTO LIBRE que escribe el mensajero, que no se emite
        // JAMAS (R22). En el resto del codigo el concepto se llama `causaDevolucion`: no se
        // «unifican». La POLITICA de contrato —solo se publica en un evento de devolucion— vive
        // AQUI, no en el repositorio, que siempre responde «cual es la causa vigente de la orden».
        motivo: datos.estado === "devuelta" ? datos.causaDevolucion : null,
      },
    });

    // R18: firma sobre `${timestamp}.${cuerpo}`; cabeceras X-Ordenex-Signature/-Timestamp.
    const timestampUnix = Math.floor(this.now().getTime() / 1000);
    const headers = cabecerasFirma(secret, timestampUnix, cuerpo);

    const outcome = await this.sender.entregar(sub.url, cuerpo, headers);
    if (outcome.status === "ok") return; // R19: 2xx -> completado

    // R20/R31: transitorio -> lanza con el `detalle` para que aterrice en `jobs.last_error`.
    // Log agregado, sin secreto/URL/PII (R29).
    this.logger.warn("[webhook_estado] entrega fallida (transitorio)");
    throw new WebhookEntregaFallidaError(outcome.detalle);
  }
}
