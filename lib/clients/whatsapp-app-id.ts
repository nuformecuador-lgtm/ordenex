// Ficha 474 (design §5.2.1, R48/D2) — el ID de la APP de Meta, obtenido del token de WhatsApp.
//
// Hace falta para la subida reanudable del documento de ejemplo de una plantilla con cabecera
// DOCUMENT (`POST /{api}/{APP_ID}/uploads`). No se le pide a nadie (D2): Graph devuelve la app
// duena del token con `GET /<apiVersion>/app`.
//
// Las tres invariantes de los clientes de Meta de este repo:
//   1. `fetch` INYECTABLE (los tests no tocan la red ni usan una credencial real);
//   2. TIMEOUT (10 s): un Graph lento no cuelga la server action;
//   3. el token va SOLO en `Authorization: Bearer`, NUNCA en la URL (`?access_token=` acabaria en
//      los logs). Por eso NO se usa `debug_token`, que exige el token en la query (design §5.2.1).
// Nunca se loguea ni se devuelve el token ni el cuerpo de la respuesta: el log lleva operacion,
// estado y codigo.
import { z } from "zod";
import { loadWhatsappConfig, WhatsappNoConfiguradoError, type WhatsappConfig } from "@/lib/config/whatsapp";

const GRAPH_BASE = "https://graph.facebook.com";
const OPERACION = "identificar la app de meta";
const TIMEOUT_MS = 10_000;

export type MotivoFalloAppId = "sin_credencial" | "http" | "red" | "timeout" | "respuesta_invalida";

export type ResultadoAppId =
  | { ok: true; appId: string; origen: "env" | "meta" }
  | {
      ok: false;
      motivo: MotivoFalloAppId;
      /** Codigo HTTP o de error de Meta; nunca el cuerpo crudo. */
      codigo?: number;
      /** Solo `sin_credencial`: el NOMBRE de la variable que falta (nunca su valor). */
      variableFaltante?: string;
    };

/** Contrato que consumen el service de plantillas (R9) y la accion `estadoAppMeta` (R48). */
export interface IResolutorAppIdMeta {
  resolver(): Promise<ResultadoAppId>;
}

/** Cache del EXITO, compartida por todo el proceso (el resolutor se construye por peticion). */
export interface CacheAppId {
  appId: string | null;
}

const CACHE_PROCESO: CacheAppId = { appId: null };

export interface LoggerAppId {
  warn(mensaje: string): void;
}

export interface ResolutorAppIdMetaOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Fuente de la credencial; por defecto `loadWhatsappConfig` (lanza si falta una pieza). */
  leerConfig?: () => WhatsappConfig;
  /** Anulacion `WHATSAPP_APP_ID`; por defecto lee `process.env`. */
  leerAnulacion?: () => string | undefined;
  cache?: CacheAppId;
  logger?: LoggerAppId;
}

const respuestaSchema = z.object({ id: z.string() });

/** Extrae `error.code` de un cuerpo de error sin lanzar. */
function codigoMeta(texto: string): number | undefined {
  try {
    const json: unknown = JSON.parse(texto);
    const code = (json as { error?: { code?: unknown } })?.error?.code;
    return typeof code === "number" ? code : undefined;
  } catch {
    return undefined;
  }
}

export class ResolutorAppIdMeta implements IResolutorAppIdMeta {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly leerConfig: () => WhatsappConfig;
  private readonly leerAnulacion: () => string | undefined;
  private readonly cache: CacheAppId;
  private readonly logger: LoggerAppId;

  constructor(opts: ResolutorAppIdMetaOpts = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.leerConfig = opts.leerConfig ?? loadWhatsappConfig;
    this.leerAnulacion = opts.leerAnulacion ?? (() => process.env.WHATSAPP_APP_ID);
    this.cache = opts.cache ?? CACHE_PROCESO;
    this.logger = opts.logger ?? { warn: (m) => console.warn(m) };
  }

  async resolver(): Promise<ResultadoAppId> {
    // 1. Anulacion por env: sin red.
    const anulacion = this.leerAnulacion()?.trim();
    if (anulacion !== undefined && anulacion !== "") {
      return { ok: true, appId: anulacion, origen: "env" };
    }
    // 2. Cache de proceso: SOLO del exito. Un fallo transitorio no deja la funcion rota.
    if (this.cache.appId !== null) return { ok: true, appId: this.cache.appId, origen: "meta" };

    // 3. Consulta a Graph con el token en la cabecera.
    let config: WhatsappConfig;
    try {
      config = this.leerConfig();
    } catch (error) {
      const variable =
        error instanceof WhatsappNoConfiguradoError
          ? (/falta ([A-Z_]+)/.exec(error.message)?.[1] ?? "WHATSAPP_CLOUD_TOKEN")
          : "WHATSAPP_CLOUD_TOKEN";
      return { ok: false, motivo: "sin_credencial", variableFaltante: variable };
    }

    const url = `${GRAPH_BASE}/${config.apiVersion}/app`;
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const esTimeout =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const motivo: MotivoFalloAppId = esTimeout ? "timeout" : "red";
      this.logger.warn(`[whatsapp] ${OPERACION}: ${motivo}`);
      return { ok: false, motivo };
    }

    if (respuesta.status < 200 || respuesta.status >= 300) {
      const cuerpo = await respuesta.text().catch(() => "");
      const codigo = codigoMeta(cuerpo) ?? respuesta.status;
      this.logger.warn(`[whatsapp] ${OPERACION}: HTTP ${respuesta.status} (codigo ${codigo})`);
      return { ok: false, motivo: "http", codigo };
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch {
      this.logger.warn(`[whatsapp] ${OPERACION}: respuesta no es JSON`);
      return { ok: false, motivo: "respuesta_invalida" };
    }
    const parsed = respuestaSchema.safeParse(json);
    if (!parsed.success || !/^\d+$/.test(parsed.data.id)) {
      this.logger.warn(`[whatsapp] ${OPERACION}: respuesta sin id numerico`);
      return { ok: false, motivo: "respuesta_invalida" };
    }
    this.cache.appId = parsed.data.id;
    return { ok: true, appId: parsed.data.id, origen: "meta" };
  }
}

/**
 * Texto de §3 (R9/R48) para un fallo. Nombra la pieza que falta o el codigo; nunca un valor
 * secreto. Lo usan el service de plantillas (`documento_no_disponible`) y `estadoAppMeta`.
 */
export function mensajeAppIdNoResuelto(r: Extract<ResultadoAppId, { ok: false }>): string {
  if (r.motivo === "sin_credencial") {
    return `Falta configurar WhatsApp (falta ${r.variableFaltante ?? "WHATSAPP_CLOUD_TOKEN"}). Las plantillas con documento no se pueden enviar a aprobación hasta resolverlo; el resto sigue funcionando.`;
  }
  const codigo =
    r.codigo !== undefined ? `código ${r.codigo}` : r.motivo === "timeout" ? "tiempo agotado" : r.motivo === "red" ? "sin conexión" : "respuesta inesperada";
  return `No se pudo identificar la app de Meta con el token de WhatsApp configurado (${codigo}). Las plantillas con documento no se pueden enviar a aprobación hasta resolverlo; el resto sigue funcionando.`;
}
