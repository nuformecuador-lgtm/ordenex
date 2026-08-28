// Feature 316 (design §3.1, R17/R19/R28) — cliente de SUBIDA de media a la Graph API.
//
// Va aparte de `whatsapp-cloud.ts` (que ENVIA mensajes) por la misma clase de razon por la que
// ya vive aparte `whatsapp-media.ts` (que DESCARGA): el metodo privado `enviar()` de aquel
// SIEMPRE fija `Content-Type: application/json` y serializa con `JSON.stringify`, y una subida
// es `multipart/form-data` donde el `Content-Type` con su `boundary` lo tiene que poner el
// RUNTIME. Es decir: justo el bit que ese metodo no puede ceder. Parchearlo con un flag
// "si es multipart no serialices" partiria en dos un metodo que hoy tiene una sola forma y
// romperia su volcado de peticion (design §8, alternativa 2, DESCARTADA).
//
// Hereda literalmente las tres invariantes de sus dos hermanos:
//
// 1. `fetch` INYECTABLE (`fetchImpl`): los tests ejercitan 2xx, rechazo, forma inesperada y
//    fallo de red SIN tocar la red y SIN credencial real.
// 2. TIMEOUT via `AbortSignal.timeout`, aqui con `TIMEOUT_SUBIDA_MS` (mas generoso que el del
//    envio: sube un binario de hasta 25 MB por el enlace de subida de una red movil).
// 3. El token va SOLO en `Authorization: Bearer`. Consecuencia OBLIGATORIA: jamas aparece en
//    una URL, en un log ni en un mensaje de error (R28). Este cliente ademas NO loguea nada:
//    ni el nombre del archivo, ni su MIME, ni un byte del contenido.
import { z } from "zod";
import type { WhatsappConfig } from "@/lib/config/whatsapp";
import { TIMEOUT_SUBIDA_MS } from "@/lib/config/chat-media-envio";

const GRAPH_BASE = "https://graph.facebook.com";

/** Nombre de la operacion citado en los detalles de error. Sin token, sin nombre de archivo. */
const OPERACION = "subir media a whatsapp";

/**
 * Contrato MINIMO de una subida correcta. Zod hace strip: lo que Meta amplie no rompe el
 * parseo pero tampoco sobrevive.
 *
 * El `min(1)` es el punto del archivo: sin el, un 200 con `{}` o con `{"id": ""}` se colaria
 * como `ok` y persistiriamos un `media_id` vacio en la columna, con una burbuja que nunca
 * podria mostrar su adjunto. Una forma inesperada es `error`, no un `ok` roto.
 */
const respuestaOkSchema = z.object({ id: z.string().min(1) });

/**
 * Desenlace de una subida, mismo molde que `WhatsappEnvioOutcome` y `WhatsappMediaOutcome`:
 * TIPADO, no excepciones.
 *
 * `rechazado` (4xx que no es 429) frente a `error` (red, timeout, 5xx) no es cosmetico: el
 * primero describe un binario o una peticion que Meta no va a aceptar nunca. Ninguno de los
 * dos se reintenta automaticamente en esta feature (design §4.1), pero la distincion es lo que
 * permite contarlo distinto en el log agregado y no prometer un reintento imposible.
 */
export type WhatsappMediaSubidaOutcome =
  | { status: "ok"; mediaId: string }
  | { status: "rechazado"; detalle: string; codigoMeta: number | null }
  | { status: "error"; detalle: string };

/** Lo que hace falta subir: el binario, su MIME y el nombre con el que viaja en el multipart. */
export interface WhatsappMediaSubidaInput {
  /** MIME ya validado por `validarAdjunto` (R8/R11). Es lo que se manda en el campo `type`. */
  mime: string;
  /** Nombre del archivo del multipart. NO se loguea (R28). */
  nombre: string;
  /** El binario TAL CUAL. No se bufferiza, no se escribe en disco ni en la base (R18/D3). */
  cuerpo: Blob;
}

export interface WhatsappMediaUploadClientOpts {
  config: WhatsappConfig;
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
}

/** Contrato minimo que consume el service (lo que se mockea en su test). */
export interface WhatsappMediaSubidor {
  subir(input: WhatsappMediaSubidaInput): Promise<WhatsappMediaSubidaOutcome>;
}

/** Extrae `error.code` de un no-2xx sin lanzar: un cuerpo no-JSON devuelve `null`. */
function codigoDeError(texto: string): number | null {
  try {
    const json: unknown = JSON.parse(texto);
    const error = (json as { error?: Record<string, unknown> })?.error;
    return typeof error?.code === "number" ? error.code : null;
  } catch {
    return null;
  }
}

export class WhatsappMediaUploadClient implements WhatsappMediaSubidor {
  private readonly config: WhatsappConfig;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WhatsappMediaUploadClientOpts) {
    this.config = opts.config;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_SUBIDA_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * `POST /<version>/<numeroId>/media` con `multipart/form-data`:
   * `messaging_product=whatsapp`, `type=<mime>` y `file=<binario con nombre>`.
   * Devuelve `{ "id": "<media-id>" }`, que es lo unico que se persiste (R18).
   *
   * NO se fija `Content-Type` a mano A PROPOSITO: el runtime lo pone junto con el `boundary`
   * del multipart al ver un `FormData` como `body`. Escribirlo aqui produciria un boundary
   * ausente o desparejado y un 400 de Meta dificilisimo de diagnosticar.
   */
  async subir(input: WhatsappMediaSubidaInput): Promise<WhatsappMediaSubidaOutcome> {
    const url = `${GRAPH_BASE}/${this.config.apiVersion}/${this.config.numeroId}/media`;

    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", input.mime);
    form.set("file", input.cuerpo, input.nombre);

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        method: "POST",
        // Solo la cabecera del token: el `Content-Type` lo pone el runtime (ver arriba).
        headers: { Authorization: `Bearer ${this.config.token}` },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Red o timeout. El detalle NO cita el token, ni el nombre del archivo, ni el destino.
      return { status: "error", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    if (respuesta.status < 200 || respuesta.status >= 300) {
      const cuerpo = await respuesta.text().catch(() => "");
      const codigo = codigoDeError(cuerpo);
      const detalle =
        `${OPERACION}: HTTP ${respuesta.status}` + (codigo === null ? "" : ` (Meta ${codigo})`);
      // 5xx y 429 son pasajeros (caida o cuota); el resto de 4xx describe un binario o una
      // peticion que Meta no aceptara por mucho que se repita.
      const esPasajero = respuesta.status >= 500 || respuesta.status === 429;
      // El `message` de Meta NO se copia al detalle: puede ecoar el nombre del archivo (R28).
      return esPasajero
        ? { status: "error", detalle }
        : { status: "rechazado", detalle, codigoMeta: codigo };
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch {
      return { status: "error", detalle: `${OPERACION}: cuerpo de respuesta no es JSON` };
    }

    const parsed = respuestaOkSchema.safeParse(json);
    if (!parsed.success) {
      // Se citan los CAMPOS que fallan, nunca su valor.
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      return { status: "error", detalle: `${OPERACION}: respuesta inesperada (${campos})` };
    }

    return { status: "ok", mediaId: parsed.data.id };
  }
}
