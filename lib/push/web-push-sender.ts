// FICHA 410 (design §5, T3.6) — EL UNICO ARCHIVO DEL REPOSITORIO QUE CONOCE LA LIBRERIA `web-push`.
//
// POR QUE NO SE IMPLEMENTA A MANO (alternativa A5 descartada): firmar un JWT ES256 y cifrar el
// payload con AES128GCM + ECDH es criptografia de la que FALLA EN SILENCIO — una entrega rechazada
// por el servicio de push se parece muchisimo a «no llego», y ninguna prueba local de este repo
// distinguiria las dos. Se usa `web-push`, encapsulada aqui para que cambiarla sea un archivo.
//
// TRADUCE, NO DECIDE. Convierte el desenlace HTTP a `PushOutcome` y NO decide si borrar la
// suscripcion ni si reintentar: eso es `PushWebService`. Es el mismo reparto que la 91 hizo con la
// geocodificacion y la 99 con los webhooks, y es lo que hace la politica testeable sin red.
import webpush from "web-push";
import type { PushConfig } from "@/lib/config/push";
import type {
  IPushSender,
  PushOutcome,
  SuscripcionParaEnvio,
} from "@/lib/interfaces/external/IPushSender";

/**
 * Codigos con los que el servicio de push dice «esta suscripcion esta MUERTA». `404` es «nunca
 * existio aqui» y `410 Gone` es «existio y el navegador la retiro»; los dos significan lo mismo
 * para nosotros y ninguno se reintenta jamas (R33).
 */
const CADUCADA = new Set([404, 410]);

/** `429` entra aqui —no en `rechazada`— porque es «ahora no», no «nunca». */
function esTransitorio(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Forma minima del error que `web-push` lanza ante un desenlace HTTP no-2xx. */
function statusDe(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : null;
}

export interface WebPushSenderOpts {
  /** Timeout por entrega. Sin el, un servicio de push colgado se come la corrida del cron. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Cuanto puede el servicio de push retener el mensaje si el telefono esta apagado, en segundos.
 *
 * Cuatro horas y no las cuatro semanas por defecto: todo lo que este canal empuja tiene PLAZO —un
 * cierre por aprobar, un reparto de hoy, un servicio caido—. Un aviso de ayer que aparece manana no
 * es util: es ruido con la fecha equivocada, y eso es justo lo que ensena a ignorar la campana.
 */
const TTL_SEGUNDOS = 4 * 60 * 60;

export class WebPushSender implements IPushSender {
  constructor(
    private readonly config: PushConfig,
    private readonly opts: WebPushSenderOpts = {},
  ) {}

  /**
   * NUNCA LANZA por un desenlace HTTP (R34). Todo —incluido un error de red o un objeto de error
   * con forma inesperada— sale como `PushOutcome`.
   *
   * ⚠️ `detalle` LLEVA EL `id` DE LA FILA Y EL CODIGO, NUNCA EL `endpoint` NI LAS CLAVES (R23). Un
   * endpoint en un log es la credencial de escritura sobre el telefono de una persona, y los logs
   * de este repo se leen desde el panel de Vercel.
   */
  async enviar(suscripcion: SuscripcionParaEnvio, payload: string): Promise<PushOutcome> {
    try {
      await webpush.sendNotification(
        {
          endpoint: suscripcion.endpoint,
          keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
        },
        payload,
        {
          vapidDetails: {
            subject: this.config.subject,
            publicKey: this.config.publicKey,
            privateKey: this.config.privateKey,
          },
          timeout: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          TTL: TTL_SEGUNDOS,
        },
      );
      return { status: "ok" };
    } catch (error) {
      const status = statusDe(error);
      if (status === null) {
        // Sin codigo: se cayo la red o el DNS. Reintentable.
        return { status: "transitorio", detalle: `suscripcion ${suscripcion.id}: sin respuesta` };
      }
      if (CADUCADA.has(status)) return { status: "caducada" };
      if (esTransitorio(status)) {
        return { status: "transitorio", detalle: `suscripcion ${suscripcion.id}: HTTP ${status}` };
      }
      // 4xx que no es 404/410/429: el problema es NUESTRO (payload mal formado, claves VAPID que
      // no casan con la suscripcion). No se reintenta, y la suscripcion NO se borra: castigar a la
      // persona por un bug nuestro la dejaria sin canal hasta que volviera a activarlo a mano.
      return { status: "rechazada", detalle: `suscripcion ${suscripcion.id}: HTTP ${status}` };
    }
  }
}
