// Feature 99 (design §7) — servicio que resuelve UN job `webhook_estado`. DI por INTERFACES
// (docs/architecture.md §Service): no conoce Next.js, ni Prisma, ni `fetch`.
//
// SEGURIDAD/PRIVACIDAD (R29): este archivo NUNCA emite por el logger el secreto de firma, la
// URL de callback ni datos del destinatario; los mensajes son agregados y citan solo la
// operacion. El secreto se descifra en memoria justo para firmar y no se loguea jamas (R32).
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type {
  DatosEntregaOrden,
  IWebhookOrdenReader,
} from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
// ⏳ 2026-09-09 (feature 404, design §D5) — la forma del mensajero se declara UNA sola vez, en el
// archivo de DTOs publicos del canal, y las tres superficies la importan. Import de TIPO puro: no
// acopla el service a nada, y `services -> types` es la direccion de siempre.
import type { ApiMensajeroDTO } from "@/lib/types/api-orden";
import type { IWebhookSender } from "@/lib/interfaces/external/IWebhookSender";
import type { WebhookConfig } from "@/lib/config/webhook";
import { descifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { cabecerasFirma } from "@/lib/crypto/webhook-firma";
import { dedupeKeyWebhookEstado } from "@/lib/services/jobs/webhook-estado-encolado";
// FICHA 403 — el circuito: un predicado puro + la config del umbral + el aviso best-effort.
import { estaPausada } from "@/lib/utils/webhook-suscripcion-pausa";
import { pausaConfigDe } from "@/lib/config/webhook";
import {
  notificadorNoOp,
  type WebhookSuscripcionPausadaNotificador,
} from "@/lib/notificaciones/notificadores";

/** Nombre del evento del cuerpo de entrega (D3). */
export const EVENTO_ESTADO = "orden.estado_actualizado";

/**
 * ⏳ 2026-08-22 (feature 268, R20/R24) — los dos estados que la POLITICA de contrato mira para
 * decidir que publica en `data`. El repositorio no los conoce: el reader siempre responde «cual es
 * la causa vigente» y es AQUI donde se decide que sale al cable (criterio heredado de la 256).
 */
const ESTADO_DEVUELTA = "devuelta";
const ESTADO_INCIDENTE = "incidente";

/**
 * ⏳ 2026-08-22 (feature 268, R22/R24/R25) — path del recurso del canal por API key al que apunta
 * `data.evidenciasUrl`. Existe desde la 177 (`app/api/ordenes/api-key/orden/[id]`), exige
 * `Authorization: Bearer ordx_...`, fuerza el owner de la key y da 404 uniforme.
 *
 * ⛔ PROHIBIDO sustituirlo por una URL FIRMADA de Storage, ni aqui ni en el handler, y prohibido
 * meter el bucket o el `storage_path` en el cuerpo. Tres razones, cada una suficiente (design
 * §7.2): (a) rompe la idempotencia del cuerpo (99/R23, fijada con tests por la 256), porque el
 * token y la expiracion cambian en cada firma; (b) caduca a los 300 s
 * (`gestionConfig.SIGNED_URL_TTL_SECONDS`) contra 5 intentos con backoff y un consumidor que puede
 * drenar horas despues; (c) es una CREDENCIAL AL PORTADOR que cualquiera que vea el cuerpo —un
 * log, un proxy, un reenvio— usa sin autenticarse. El enlace es estable y determinista: sin token,
 * sin expiracion y calculable sin consultar Storage. La credencial la pone el integrador, que es
 * donde debe estar. Se elige la variante por `orden.id` y no por `numGuia` porque `num_guia` puede
 * ser NULL y el `ordenId` siempre esta en el payload del job.
 */
const PATH_ORDEN_API_KEY = "/api/ordenes/api-key/orden";

/**
 * Forma del `data` del cuerpo. `motivo` SIEMPRE presente (convencion de la 256); `mensajero`
 * SIEMPRE presente (convencion de la 404); `evidenciasUrl` opcional (convencion de la 268, y la
 * UNICA clave opcional que queda). Ver el comentario de `armarData`.
 */
interface DataEvento {
  numGuia: number | null;
  numRemision: string;
  estado: string | null;
  motivo: CausaDevolucion | CausaIncidente | null;
  mensajero: ApiMensajeroDTO | null;
  evidenciasUrl?: string;
}

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
  /**
   * FICHA 403 (design §6) — cuanto conviene esperar antes del proximo intento, en ms, o
   * `undefined` si no hay nada que sugerir (y entonces la cola aplica su backoff de siempre).
   *
   * DOS ORIGENES DISTINTOS QUE COMPARTEN CANAL A PROPOSITO: el `Retry-After` de un 429 real (R14)
   * y el intervalo de pausa del circuito (R4). `JobQueueService` no distingue entre ellos ni
   * necesita hacerlo — solo lee «este error trae una sugerencia de espera» y la acota (R17).
   *
   * PUBLICO Y DE SOLO LECTURA: la cola lo lee por duck-typing, sin importar esta clase (no debe
   * conocer los tipos de job concretos).
   */
  readonly retryAfterMs?: number;

  constructor(detalle: string, retryAfterMs?: number) {
    super(detalle);
    this.name = "WebhookEntregaFallidaError";
    this.retryAfterMs = retryAfterMs;
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
    /**
     * FICHA 403 (R9/R10/R11) — aviso al `maestro` cuando esta suscripcion esta pausada. DEFAULT
     * NO-OP: un service construido sin cablearlo —tipicamente un doble de test— no escribe nada en
     * la base, que en este repo es COMPARTIDA. El notificador REAL lo inyecta el composition root
     * (`lib/services/jobs/webhook-estado-handler.ts`), nunca este archivo.
     */
    private readonly notificarPausa: WebhookSuscripcionPausadaNotificador = notificadorNoOp,
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
      data: this.armarData(datos, ordenId),
    });

    // R18: firma sobre `${timestamp}.${cuerpo}`; cabeceras X-Ordenex-Signature/-Timestamp.
    const timestampUnix = Math.floor(this.now().getTime() / 1000);
    const headers = cabecerasFirma(secret, timestampUnix, cuerpo);

    const outcome = await this.sender.entregar(sub.url, cuerpo, headers);
    if (outcome.status === "ok") {
      // FICHA 403 (R2): el 2xx CIERRA la racha — contador a cero y ancla al momento del exito. Con
      // eso la suscripcion SALE DE LA PAUSA de inmediato y sin intervencion manual, porque
      // `estaPausada()` se evalua sobre esos dos datos. Es la propiedad que un `activa = false` no
      // tenia: aqui no hay ningun estado del que solo un humano pueda sacarla.
      await this.suscripciones.registrarEntregaOk(datos.tiendaId, this.now());
      return; // R19: 2xx -> completado
    }

    // R20/R31: transitorio -> lanza con el `detalle` para que aterrice en `jobs.last_error`.
    // Log agregado, sin secreto/URL/PII (R29).
    this.logger.warn("[webhook_estado] entrega fallida (transitorio)");
    // FICHA 403 (R14): por defecto, lo unico que sugiere esperar es un 429 con `Retry-After`.
    let retryAfterMs = outcome.retryAfterMs;

    // FICHA 403 (R3): SOLO cuenta lo que llego a intentar la peticion HTTP. Un payload invalido o
    // un `WebhookSecretKeyError` salieron ANTES por `throw`, asi que no pasan por aqui: son
    // problemas NUESTROS de configuracion y penalizarian con reintentos espaciados a un destino
    // sano.
    const ahora = this.now();
    const estado = await this.suscripciones.incrementarFalloYLeer(datos.tiendaId, ahora);
    if (estado !== null) {
      const pausada = estaPausada(
        estado.fallosConsecutivos,
        estado.sinExitoDesde,
        ahora,
        pausaConfigDe(this.config),
      );
      if (pausada) {
        // R9-R13. SIN codigo de deteccion de transicion (design §4): se intenta notificar en CADA
        // fallo mientras la suscripcion este pausada, y la deduplicacion por RACHA la hace el
        // `entidadId` del aviso contra `notificacion_dedupe_key`. Se probo la alternativa
        // —reconstruir el estado previo restando uno al contador— y NO funciona: no distingue el
        // caso en que el conteo ya superaba el umbral desde hacia rato y es el TIEMPO el que acaba
        // de cumplirse.
        //
        // BEST-EFFORT (R11): `notificarPausa` absorbe y registra su propio fallo; no puede tumbar
        // el resto del lote. El contexto lleva un id y una fecha, jamas la URL ni el secreto (R13).
        await this.notificarPausa({
          ownerUsuarioId: datos.tiendaId,
          sinExitoDesde: estado.sinExitoDesde,
        });
        // R4: el UNICO efecto observable de cruzar el umbral. `activa` no se toca en ninguna rama
        // de este metodo (R5): la suscripcion sigue viva, sigue encolando y sigue reintentando —
        // solo mas espaciada. La cola lo acota a `JOBS_BACKOFF_CAP_MS` (R17).
        retryAfterMs = this.config.WEBHOOK_PAUSA_INTERVALO_MS;
      }
    }
    // R6: si NO esta pausada (fallos insuficientes o ventana sin cumplir —incluida una caida corta
    // y aislada—), `retryAfterMs` sigue siendo lo que trajera el 429, o `undefined`, y la cola
    // aplica su backoff exponencial generico exactamente como antes de esta ficha.
    throw new WebhookEntregaFallidaError(outcome.detalle, retryAfterMs);
  }

  /**
   * El `data` del cuerpo. Orden de insercion FIJO: la firma se calcula sobre el string
   * serializado, asi que reordenar claves cambiaria la firma (99/R18, 256/R7).
   *
   * ⚠️ DOS CONVENCIONES DE AUSENCIA QUE CONVIVEN A PROPOSITO, y no es un descuido:
   *  - `motivo` esta SIEMPRE PRESENTE y vale `null` cuando no aplica. Es un campo de la 256 con
   *    forma UNICA ya PUBLICADA en el OpenAPI («las claves estan siempre presentes, sea cual sea
   *    el estado; el consumidor no ramifica por estado para saber si un campo existe»). Omitirlo
   *    ahora seria cambiar un contrato ya anunciado.
   *  - `evidenciasUrl` se OMITE cuando no aplica. Es ADITIVO y OPCIONAL desde el dia uno
   *    (268/R19/R24): nunca se publico con forma unica, y R24 exige literalmente que «no viaje»
   *    cuando el estado no es `incidente`.
   *
   * ⏳ 2026-09-09 (feature 404, R2/R8/R10, design §D3) — `mensajero` cae en el PRIMER grupo:
   * SIEMPRE presente, `null` cuando nadie lleva la orden. Y cae ahi por lo que distingue a los dos
   * grupos, no por parecido: en `evidenciasUrl` la ausencia significa «NO APLICA» (no hay
   * incidente, no hay nada que enlazar) y omitirla ES informacion; en `mensajero` significaria
   * «NADIE LA LLEVA», que es un hecho del negocio que el integrador necesita leer para su
   * denominador —`null` lo dice; omitir la clave lo esconde detras de una ramificacion por
   * presencia—. Ademas es lo que se pidio literalmente. Con esto `data` tiene CINCO claves siempre
   * presentes y `evidenciasUrl` sigue siendo la UNICA opcional.
   *
   * ⚠️ SU POSICION ES LOAD-BEARING, como la de todas: va tras `motivo` (final del bloque siempre
   * presente) y ANTES del bloque de `evidenciasUrl`, que sigue cerrando el objeto. La firma se
   * calcula sobre el string ya serializado, asi que mover esta linea cambia el cuerpo y cambia la
   * firma; ademas, insertar aqui deja el diff respecto del cuerpo de ayer como una INSERCION y no
   * como un reordenamiento (R10).
   */
  private armarData(datos: DatosEntregaOrden, ordenId: string): DataEvento {
    const data: DataEvento = {
      numGuia: datos.numGuia,
      numRemision: datos.numRemision,
      estado: datos.estado,
      // Feature 256 (R1-R7) + feature 268 (R20/R21). ⚠️ DOS `motivo` DISTINTOS QUE COMPARTEN
      // NOMBRE, y esta es la UNICA linea donde el nombre publico se pega al dato: `data.motivo`
      // transporta la causa TIPIFICADA (enum cerrado de 3 valores: `gestion_orden.causa_devolucion`
      // en una devolucion, `gestion_orden.causa_incidente` u `orden_incidente.causa` en un
      // incidente) y NO es `gestion_orden.motivo` (`db/schema.prisma:814`), el TEXTO LIBRE que
      // escribe el mensajero, que no se emite JAMAS (256/R22). En el resto del codigo cada
      // concepto se llama por su nombre propio (`causaDevolucion` / `causaIncidente`): no se
      // «unifican». `motivo` es SOLO el nombre de CABLE, REUSADO para las dos causas (268,
      // pregunta abierta 1 resuelta: #434 uso el nombre generico).
      //
      // IDIOMA: la causa de devolucion va en INGLES y la de incidente en ESPANOL
      // (`danado`/`perdido`/`robado`), sin traducir. Asimetria CONSCIENTE y FIRMADA
      // (73/F1.4-g y 158/Q-B): NO se «corrige» aqui ni se abre ticket de consistencia.
      //
      // La POLITICA de contrato vive AQUI, no en el repositorio, que siempre responde «cual es la
      // causa vigente de la orden» sea cual sea el estado destino del evento.
      motivo: this.motivoPublicado(datos),
      // ⏳ 2026-09-09 (feature 404, R7/R8/R11): el mensajero ASIGNADO que el reader acaba de leer
      // —«quien la LLEVA», no «quien la gestiono»—, vigente en el instante de ESTA entrega. No hay
      // ningun `mensajeroPublicado()` paralelo a `motivoPublicado()` a proposito: aqui la politica
      // de contrato es «se publica siempre», y una indireccion sin decision dentro solo esconde
      // que no hay decision.
      mensajero: datos.mensajero,
    };

    const evidenciasUrl = this.evidenciasUrlDe(datos.estado, ordenId);
    if (evidenciasUrl !== null) data.evidenciasUrl = evidenciasUrl;
    return data;
  }

  /** 268/R20/R21: la causa que se publica segun el estado destino; `null` si no aplica. */
  private motivoPublicado(datos: DatosEntregaOrden): CausaDevolucion | CausaIncidente | null {
    if (datos.estado === ESTADO_DEVUELTA) return datos.causaDevolucion;
    if (datos.estado === ESTADO_INCIDENTE) return datos.causaIncidente;
    return null;
  }

  /**
   * 268/R22/R24/R25: el enlace ESTABLE a las evidencias, solo en un evento de `incidente`.
   * `null` (-> campo omitido) si el estado no es `incidente` o si el origin no se resuelve: NUNCA
   * una ruta relativa ni un `https://undefined/...`.
   */
  private evidenciasUrlDe(estado: string | null, ordenId: string): string | null {
    if (estado !== ESTADO_INCIDENTE) return null;
    const origin = this.config.WEBHOOK_APP_ORIGIN;
    if (origin === null) return null;
    return `${origin}${PATH_ORDEN_API_KEY}/${ordenId}`;
  }
}
