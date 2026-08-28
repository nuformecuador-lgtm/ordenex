// Feature 308 (design §5.3, R21/R24/R35) — cliente de DESCARGA de media de la Graph API.
//
// Va aparte de `whatsapp-cloud.ts` (que ENVIA) porque su desenlace es distinto: aqui no hay
// `transitorio` que reintentar, hay un binario que servir o un "ya no existe" que contar. Hereda
// las tres invariantes de aquel archivo:
//
// 1. `fetch` INYECTABLE (`fetchImpl`): los tests ejercitan 2xx, caducidad y fallo de red SIN
//    tocar la red y SIN credencial real.
// 2. TIMEOUT via `AbortSignal.timeout`: una Graph API lenta no cuelga el route handler.
// 3. El token va en la cabecera `Authorization: Bearer`. Consecuencia OBLIGATORIA: NUNCA
//    aparece en un mensaje de error, en un log ni en una URL (R35).
//
// Y añade una cuarta, propia:
//
// 4. La `url` TEMPORAL que devuelve Meta se consume AQUI y no se reenvia al navegador. Es un
//    enlace autenticado por token a la media del cliente: reenviarlo seria filtrar el acceso.
import { z } from "zod";
import type { WhatsappConfig } from "@/lib/config/whatsapp";
import { TIMEOUT_MEDIA_MS } from "@/lib/config/chat-media";

const GRAPH_BASE = "https://graph.facebook.com";

/** Nombre de la operacion citado en los detalles de error. Sin token, sin media id, sin numero. */
const OPERACION = "descargar media de whatsapp";

/**
 * Codigo generico de la Graph API para "el objeto no existe / no se puede leer". Es uno de los
 * tres sintomas de un binario ya borrado (los otros dos: 404 y `url` vacia).
 */
const CODIGO_OBJETO_INEXISTENTE = 100;

/** Metadatos del media. Zod hace strip: lo que Meta amplie no rompe ni sobrevive. */
const metadatosSchema = z.object({
  url: z.string().optional().catch(undefined),
  mime_type: z.string().optional().catch(undefined),
  file_size: z.number().optional().catch(undefined),
});

/**
 * Desenlace de una descarga, calcado de `WhatsappEnvioOutcome`.
 *
 * `expirado` NO es un `error` mas, y esa distincion ES el requisito R24: Meta borra el binario a
 * los 30 dias, y la UI tiene que poder decir "este archivo ya no esta disponible" en vez de
 * pintar un icono roto o un error generico que el mensajero no sabe interpretar.
 */
export type WhatsappMediaOutcome =
  | {
      status: "ok";
      /** Cuerpo de la respuesta de Meta, SIN bufferizar (design §5.3). */
      cuerpo: ReadableStream<Uint8Array> | null;
      mime: string | null;
      tamano: number | null;
    }
  | { status: "expirado" }
  | { status: "error"; detalle: string };

export interface WhatsappMediaClientOpts {
  config: WhatsappConfig;
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
}

/** Contrato minimo que consume la ruta proxy (lo que se mockea en su test). */
export interface WhatsappMediaDescargador {
  descargar(mediaId: string): Promise<WhatsappMediaOutcome>;
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

export class WhatsappMediaClient implements WhatsappMediaDescargador {
  private readonly config: WhatsappConfig;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WhatsappMediaClientOpts) {
    this.config = opts.config;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MEDIA_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Dos saltos, como manda la Graph API: (1) `GET /<version>/<media-id>` devuelve una `url`
   * temporal y los metadatos; (2) `GET <url>` con el mismo Bearer devuelve el binario.
   *
   * No loguea NADA: ni el media id, ni la url temporal, ni el token (R35). Los detalles de error
   * citan la OPERACION y el codigo HTTP, que es lo unico accionable.
   */
  async descargar(mediaId: string): Promise<WhatsappMediaOutcome> {
    const metadatos = await this.pedirMetadatos(mediaId);
    if (metadatos.status !== "ok") return metadatos;

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(metadatos.url, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { status: "error", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    // El binario tambien puede haber caducado ENTRE los dos saltos: la url temporal es corta.
    if (respuesta.status === 404 || respuesta.status === 410) return { status: "expirado" };
    if (respuesta.status < 200 || respuesta.status >= 300) {
      return { status: "error", detalle: `${OPERACION}: HTTP ${respuesta.status}` };
    }

    const largo = respuesta.headers.get("content-length");
    return {
      status: "ok",
      // Passthrough del stream: un video de WhatsApp llega a ~16 MB y un documento a 100 MB;
      // bufferizarlo en una funcion serverless es memoria y latencia por nada.
      cuerpo: respuesta.body,
      mime: respuesta.headers.get("content-type") ?? metadatos.mime,
      tamano: largo === null ? metadatos.tamano : Number(largo),
    };
  }

  private async pedirMetadatos(
    mediaId: string,
  ): Promise<
    | { status: "ok"; url: string; mime: string | null; tamano: number | null }
    | { status: "expirado" }
    | { status: "error"; detalle: string }
  > {
    const url = `${GRAPH_BASE}/${this.config.apiVersion}/${encodeURIComponent(mediaId)}`;

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { status: "error", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    if (respuesta.status < 200 || respuesta.status >= 300) {
      const cuerpo = await respuesta.text().catch(() => "");
      const codigo = codigoDeError(cuerpo);
      // Los TRES sintomas de "el binario ya no existe" (R24/D2): 404, el codigo 100 de objeto
      // inexistente, y (mas abajo) una `url` vacia en un 2xx. Cualquier otra cosa es un fallo
      // de la Graph API, que es un problema distinto y se cuenta distinto.
      if (respuesta.status === 404 || codigo === CODIGO_OBJETO_INEXISTENTE) {
        return { status: "expirado" };
      }
      return {
        status: "error",
        detalle:
          `${OPERACION}: HTTP ${respuesta.status}` + (codigo === null ? "" : ` (Meta ${codigo})`),
      };
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch {
      return { status: "error", detalle: `${OPERACION}: cuerpo de respuesta no es JSON` };
    }

    const parsed = metadatosSchema.safeParse(json);
    if (!parsed.success) {
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      return { status: "error", detalle: `${OPERACION}: respuesta inesperada (${campos})` };
    }

    const enlace = parsed.data.url?.trim();
    if (enlace === undefined || enlace === "") return { status: "expirado" };

    return {
      status: "ok",
      url: enlace,
      mime: parsed.data.mime_type ?? null,
      tamano: parsed.data.file_size ?? null,
    };
  }
}
