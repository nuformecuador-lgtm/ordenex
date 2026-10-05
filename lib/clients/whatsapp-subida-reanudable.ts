// Ficha 474 (design §5.2, R5) — SUBIDA REANUDABLE del documento de ejemplo de una plantilla con
// cabecera DOCUMENT.
//
// Meta exige, para crear un template con cabecera de media, un `header_handle` obtenido con la
// Resumable Upload API, que cuelga del ID de la APP (no del numero ni de la WABA):
//   1. `POST /{api}/{APP_ID}/uploads?file_name&file_length&file_type` → `{ id: "upload:…" }`
//   2. `POST /{api}/{upload_id}` con `Authorization: OAuth <token>`, `file_offset: 0` y el binario
//      → `{ h: "<handle>" }`
// No sirve `WhatsappMediaUploadClient` (`/{numero}/media`): ese da un `media_id` para ENVIAR, no un
// handle para el EJEMPLO de la plantilla.
//
// Mismo molde que sus hermanos: `fetch` inyectable, timeout, desenlace TIPADO y el token SOLO en
// cabecera (nunca en URL, log ni error). Recibe el `appId` YA RESUELTO: no lee env.
import { z } from "zod";
import type { WhatsappConfig } from "@/lib/config/whatsapp";
import { TIMEOUT_SUBIDA_MS } from "@/lib/config/chat-media-envio";

const GRAPH_BASE = "https://graph.facebook.com";
const OPERACION = "subir documento de ejemplo a meta";
const TIMEOUT_MS = TIMEOUT_SUBIDA_MS;

export type SubidaReanudableOutcome =
  | { status: "ok"; handle: string }
  | { status: "rechazado"; detalle: string; codigoMeta: number | null }
  | { status: "error"; detalle: string };

export interface SubidaReanudableInput {
  appId: string;
  bytes: Uint8Array;
  nombreArchivo: string;
  mime: "application/pdf";
}

export interface IWhatsappSubidaReanudable {
  subir(input: SubidaReanudableInput): Promise<SubidaReanudableOutcome>;
}

export interface WhatsappSubidaReanudableClientOpts {
  config: Pick<WhatsappConfig, "token" | "apiVersion">;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const sesionSchema = z.object({ id: z.string().min(1) });
const handleSchema = z.object({ h: z.string().min(1) });

function codigoDeError(texto: string): number | null {
  try {
    const json: unknown = JSON.parse(texto);
    const code = (json as { error?: { code?: unknown } })?.error?.code;
    return typeof code === "number" ? code : null;
  } catch {
    return null;
  }
}

export class WhatsappSubidaReanudableClient implements IWhatsappSubidaReanudable {
  private readonly config: Pick<WhatsappConfig, "token" | "apiVersion">;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WhatsappSubidaReanudableClientOpts) {
    this.config = opts.config;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async subir(input: SubidaReanudableInput): Promise<SubidaReanudableOutcome> {
    // Paso 1: abrir la sesion de subida.
    const inicio = new URL(`${GRAPH_BASE}/${this.config.apiVersion}/${input.appId}/uploads`);
    inicio.searchParams.set("file_name", input.nombreArchivo);
    inicio.searchParams.set("file_length", String(input.bytes.byteLength));
    inicio.searchParams.set("file_type", input.mime);

    const r1 = await this.llamar(inicio.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    if (r1.status !== "ok") return r1;
    const sesion = sesionSchema.safeParse(r1.json);
    if (!sesion.success) return { status: "error", detalle: `${OPERACION}: sesion sin id` };

    // Paso 2: subir el binario. `OAuth` y no `Bearer`: es lo que documenta Meta para este paso.
    const r2 = await this.llamar(`${GRAPH_BASE}/${this.config.apiVersion}/${sesion.data.id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${this.config.token}`, file_offset: "0" },
      body: new Blob([input.bytes as BlobPart], { type: input.mime }),
    });
    if (r2.status !== "ok") return r2;
    const handle = handleSchema.safeParse(r2.json);
    if (!handle.success) return { status: "error", detalle: `${OPERACION}: respuesta sin handle` };
    return { status: "ok", handle: handle.data.h };
  }

  private async llamar(
    url: string,
    init: RequestInit,
  ): Promise<{ status: "ok"; json: unknown } | Exclude<SubidaReanudableOutcome, { status: "ok" }>> {
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      return { status: "error", detalle: `${OPERACION}: fallo de red o timeout` };
    }
    if (respuesta.status < 200 || respuesta.status >= 300) {
      const cuerpo = await respuesta.text().catch(() => "");
      const codigo = codigoDeError(cuerpo);
      const detalle = `${OPERACION}: HTTP ${respuesta.status}` + (codigo === null ? "" : ` (Meta ${codigo})`);
      const pasajero = respuesta.status >= 500 || respuesta.status === 429;
      return pasajero ? { status: "error", detalle } : { status: "rechazado", detalle, codigoMeta: codigo };
    }
    try {
      return { status: "ok", json: await respuesta.json() };
    } catch {
      return { status: "error", detalle: `${OPERACION}: cuerpo no es JSON` };
    }
  }
}
