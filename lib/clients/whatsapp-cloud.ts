// Cliente HTTP de WhatsApp Cloud API (Meta Graph API). Envia mensajes salientes
// por el numero configurado. Mismo molde que google-geocode.ts / webhook-sender.ts.
//
// TRES INVARIANTES DE ESTE ARCHIVO:
//
// 1. `fetch` INYECTABLE (`fetchImpl`): los tests ejercitan 2xx, error del proveedor,
//    timeout y fallo de red SIN tocar la red y SIN credencial real.
// 2. TIMEOUT via `AbortSignal.timeout(timeoutMs)`: la Graph API lenta no cuelga
//    el flujo que dispara el mensaje (webhook, server action, cron).
// 3. El token va en la cabecera `Authorization: Bearer`. Consecuencia OBLIGATORIA:
//    NUNCA aparece en un mensaje de error ni en un log. Los detalles citan la
//    OPERACION y el ESTADO (codigo HTTP, "timeout"/"red"), jamas el token ni el
//    numero destino (que es dato personal).
import { z } from "zod";
import type { WhatsappConfig } from "@/lib/config/whatsapp";

const GRAPH_BASE = "https://graph.facebook.com";

/** Nombre de la operacion citado en los detalles de error. Sin token, sin destino. */
const OPERACION = "enviar mensaje de whatsapp";

/**
 * La Graph API rechazo la peticion o no respondio. El mensaje identifica la
 * OPERACION y el estado; nunca el token ni el numero destino.
 */
export class WhatsappEnvioError extends Error {
  constructor(detalle: string) {
    super(`${OPERACION}: ${detalle}`);
    this.name = "WhatsappEnvioError";
  }
}

// Contrato MINIMO de una respuesta OK. Zod hace strip: campos extra que Meta
// amplie no rompen el parseo pero tampoco sobreviven.
const respuestaOkSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).min(1),
});

/** Desenlace de un envio. `ok` trae el id que asigna Meta al mensaje. */
export type WhatsappEnvioOutcome =
  | { status: "ok"; mensajeId: string }
  | { status: "transitorio"; detalle: string };

export interface WhatsappCloudClientOpts {
  config: WhatsappConfig;
  /** Timeout de la llamada en ms. */
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
}

export class WhatsappCloudClient {
  private readonly config: WhatsappConfig;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WhatsappCloudClientOpts) {
    this.config = opts.config;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Envia un mensaje de texto plano al numero destino (formato E.164 sin `+`,
   * p. ej. "573001234567"). Devuelve el desenlace; los fallos de red o codigos
   * no-2xx son `transitorio` (reintentables) y su detalle no filtra secretos.
   */
  async enviarTexto(destino: string, texto: string): Promise<WhatsappEnvioOutcome> {
    return this.enviar({
      messaging_product: "whatsapp",
      to: destino,
      type: "text",
      text: { body: texto },
    });
  }

  /**
   * Envia una plantilla aprobada por Meta. `componentes` sigue el formato de la
   * Graph API (parametros de header/body/botones). Usar esto para iniciar
   * conversaciones fuera de la ventana de 24 h.
   */
  async enviarPlantilla(
    destino: string,
    nombre: string,
    idioma: string,
    componentes?: unknown[],
  ): Promise<WhatsappEnvioOutcome> {
    return this.enviar({
      messaging_product: "whatsapp",
      to: destino,
      type: "template",
      template: {
        name: nombre,
        language: { code: idioma },
        ...(componentes ? { components: componentes } : {}),
      },
    });
  }

  private async enviar(cuerpo: unknown): Promise<WhatsappEnvioOutcome> {
    const url = `${GRAPH_BASE}/${this.config.apiVersion}/${this.config.numeroId}/messages`;

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // El token va aqui, NUNCA en la URL ni en un log (invariante 3).
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Fallo de RED o timeout -> transitorio. El detalle no incluye token ni destino.
      return { status: "transitorio", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    if (respuesta.status < 200 || respuesta.status >= 300) {
      // Cualquier codigo no-2xx -> transitorio. Se cita solo el codigo, jamas el
      // cuerpo de la respuesta (puede ecoar el destino).
      return { status: "transitorio", detalle: `${OPERACION}: HTTP ${respuesta.status}` };
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch {
      throw new WhatsappEnvioError("cuerpo de respuesta no es JSON");
    }

    const parsed = respuestaOkSchema.safeParse(json);
    if (!parsed.success) {
      // Forma inesperada en un 2xx: se citan los campos que fallan, nunca el valor.
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new WhatsappEnvioError(`respuesta con forma inesperada (${campos})`);
    }

    return { status: "ok", mensajeId: parsed.data.messages[0].id };
  }
}

// ---------------------------------------------------------------------------
// CRUD de plantillas (Message Templates de Meta)
//
// Las plantillas se gestionan contra la WhatsApp Business Account (WABA), NO
// contra el numero: los endpoints cuelgan de `/{wabaId}/message_templates`. El
// token es el mismo del envio (invariante 3 sigue vigente: nunca en URL ni log).
//
// A diferencia del envio (que corre en el drenado de una cola y devuelve un
// desenlace `transitorio` reintentable), el CRUD lo dispara un admin desde una
// server action: un fallo se PROPAGA con contexto (WhatsappPlantillaError) para
// que la UI lo muestre, no se traga como reintentable.
// ---------------------------------------------------------------------------

/** Categoria que Meta exige al crear una plantilla. */
export type PlantillaCategoria = "MARKETING" | "UTILITY" | "AUTHENTICATION";

/** Nombre de la operacion citado en los errores del CRUD. Sin token, sin WABA. */
const OPERACION_PLANTILLA = "gestionar plantilla de whatsapp";

/**
 * La Graph API rechazo una operacion del CRUD o respondio con forma inesperada.
 * El mensaje cita la operacion y el estado; nunca el token ni el WABA id.
 */
export class WhatsappPlantillaError extends Error {
  constructor(detalle: string) {
    super(`${OPERACION_PLANTILLA}: ${detalle}`);
    this.name = "WhatsappPlantillaError";
  }
}

/** Datos para crear una plantilla. `components` sigue el formato de la Graph API. */
export interface CrearPlantillaInput {
  /** Nombre unico en la WABA (minusculas, guion bajo). Inmutable tras crear. */
  nombre: string;
  /** Codigo de idioma, p. ej. "es" o "es_CO". Inmutable tras crear. */
  idioma: string;
  categoria: PlantillaCategoria;
  /** Header/body/footer/botones en el formato que espera Meta. */
  components: unknown[];
}

/** Cambios permitidos al editar. Meta NO deja cambiar nombre ni idioma. */
export interface ActualizarPlantillaInput {
  categoria?: PlantillaCategoria;
  components?: unknown[];
}

/** Resultado de crear una plantilla: queda "PENDING" hasta que Meta la revisa. */
export interface PlantillaCreada {
  id: string;
  status: string;
  category?: string;
}

/** Resumen de una plantilla existente devuelto por el listado. */
export interface PlantillaResumen {
  id: string;
  nombre: string;
  idioma: string;
  status: string;
  categoria: string;
  components?: unknown[];
}

export interface ListarPlantillasOpts {
  /** Filtra por nombre exacto. */
  nombre?: string;
  /** Tope de resultados por pagina. */
  limite?: number;
}

const crearRespuestaSchema = z.object({
  id: z.string(),
  status: z.string(),
  category: z.string().optional(),
});

const plantillaResumenSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  status: z.string(),
  category: z.string(),
  components: z.array(z.unknown()).optional(),
});

const listarRespuestaSchema = z.object({
  data: z.array(plantillaResumenSchema),
});

const exitoSchema = z.object({ success: z.boolean() });

export interface WhatsappPlantillasClientOpts {
  config: WhatsappConfig;
  /** Timeout de la llamada en ms. */
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red. */
  fetchImpl?: typeof fetch;
}

export class WhatsappPlantillasClient {
  private readonly config: WhatsappConfig;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WhatsappPlantillasClientOpts) {
    this.config = opts.config;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** CREATE — da de alta una plantilla. Queda en revision (status "PENDING"). */
  async crear(input: CrearPlantillaInput): Promise<PlantillaCreada> {
    const json = await this.request("POST", this.coleccionUrl(), {
      name: input.nombre,
      language: input.idioma,
      category: input.categoria,
      components: input.components,
    });
    return this.parse(crearRespuestaSchema, json);
  }

  /** READ — lista las plantillas de la WABA, opcionalmente filtradas por nombre. */
  async listar(opts: ListarPlantillasOpts = {}): Promise<PlantillaResumen[]> {
    const url = this.coleccionUrl();
    if (opts.nombre !== undefined) url.searchParams.set("name", opts.nombre);
    if (opts.limite !== undefined) url.searchParams.set("limit", String(opts.limite));

    const json = await this.request("GET", url);
    const parsed = this.parse(listarRespuestaSchema, json);
    return parsed.data.map((p) => ({
      id: p.id,
      nombre: p.name,
      idioma: p.language,
      status: p.status,
      categoria: p.category,
      components: p.components,
    }));
  }

  /**
   * UPDATE — edita una plantilla por su id. Solo categoria y/o components; Meta
   * no permite cambiar nombre ni idioma (para eso se crea una nueva).
   */
  async actualizar(plantillaId: string, cambios: ActualizarPlantillaInput): Promise<void> {
    const cuerpo: Record<string, unknown> = {};
    if (cambios.categoria !== undefined) cuerpo.category = cambios.categoria;
    if (cambios.components !== undefined) cuerpo.components = cambios.components;
    if (Object.keys(cuerpo).length === 0) {
      throw new WhatsappPlantillaError("actualizar sin cambios (ni categoria ni components)");
    }

    const url = new URL(`${GRAPH_BASE}/${this.config.apiVersion}/${plantillaId}`);
    const json = await this.request("POST", url, cuerpo);
    this.parse(exitoSchema, json);
  }

  /**
   * DELETE — borra una plantilla por nombre (todas sus versiones de idioma). Para
   * borrar una version concreta, pasa tambien su `hsmId` (el id de la plantilla).
   */
  async eliminar(nombre: string, hsmId?: string): Promise<void> {
    const url = this.coleccionUrl();
    url.searchParams.set("name", nombre);
    if (hsmId !== undefined) url.searchParams.set("hsm_id", hsmId);

    const json = await this.request("DELETE", url);
    this.parse(exitoSchema, json);
  }

  /** URL de la coleccion de plantillas de la WABA. */
  private coleccionUrl(): URL {
    console.log(`${GRAPH_BASE}/${this.config.apiVersion}/${this.config.wabaId}/message_templates`);
    return new URL(
      `${GRAPH_BASE}/${this.config.apiVersion}/${this.config.wabaId}/message_templates`,
    );
  }

  /**
   * Envia la peticion a la Graph API y devuelve el JSON. Un fallo de red, un
   * codigo no-2xx o un cuerpo no-JSON se propagan como WhatsappPlantillaError
   * SIN filtrar token ni WABA (solo operacion, metodo y estado).
   */
  private async request(
    metodo: "GET" | "POST" | "DELETE",
    url: URL,
    cuerpo?: unknown,
  ): Promise<unknown> {
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url.toString(), {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new WhatsappPlantillaError(`${metodo}: fallo de red o timeout`);
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch {
      throw new WhatsappPlantillaError(`${metodo} HTTP ${respuesta.status}: cuerpo no es JSON`);
    }

    if (respuesta.status < 200 || respuesta.status >= 300) {
      // Se cita el codigo HTTP y, si Meta lo da, el `code` del error; nunca el
      // `message` completo (puede ecoar datos de la peticion).
      const codigo = extraerCodigoError(json);
      throw new WhatsappPlantillaError(
        `${metodo} HTTP ${respuesta.status}${codigo !== undefined ? ` (code ${codigo}), reason: ${JSON.stringify((json as any)?.error)}` : ""}`,
      );
    }

    return json;
  }

  /** Valida la respuesta contra el schema; forma inesperada -> error sin valores. */
  private parse<T>(schema: z.ZodType<T>, json: unknown): T {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new WhatsappPlantillaError(`respuesta con forma inesperada (${campos})`);
    }
    return parsed.data;
  }
}

/** Extrae `error.code` del cuerpo de error de la Graph API si esta presente. */
function extraerCodigoError(json: unknown): number | undefined {
  const forma = z.object({ error: z.object({ code: z.number() }) }).safeParse(json);
  return forma.success ? forma.data.error.code : undefined;
}
