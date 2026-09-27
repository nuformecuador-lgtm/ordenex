import { z } from "zod";

import type {
  ConsultaAsistente,
  DocumentoContexto,
  IAsistenteProvider,
  MensajeAsistente,
  RespuestaAsistente,
  TrozoProveedor,
} from "@/lib/interfaces/external/IAsistenteProvider";

/**
 * ⭑ FICHA 436 — EL ADAPTADOR DE PRODUCCIÓN: la API de Anthropic (`/v1/messages`), en streaming.
 *
 * Es el ÚNICO archivo de la ficha que sabe que detrás del asistente hay HTTP. Tres invariantes
 * copiadas de `lib/clients/google-routes.ts`:
 *
 *  1. **`fetch` y credencial INYECTABLES** -> ni un test de esta ficha toca la red ni gasta un
 *     céntimo. Si algún test de `asistente` sale a internet, está mal escrito.
 *  2. **Validación en el BORDE** de lo que devuelve el proveedor: cada evento del stream se
 *     valida con zod antes de convertirse en `TrozoProveedor`. Un evento con forma inesperada se
 *     ignora; no se cuela hacia arriba como `undefined`.
 *  3. **Ningún mensaje de error cita la credencial, la URL ni el cuerpo crudo del proveedor**
 *     (R21). Lo que viaja hacia arriba es `"asistente: HTTP 429"` y nada más.
 */

/** El endpoint. Es una constante privada y NO aparece en ningún `detalle` (R21). */
const ENDPOINT = "https://api.anthropic.com/v1/messages";

/** Versión de la API que este adaptador sabe leer. Va en cabecera, la exige el proveedor. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Nombre de la operación que se cita en los errores. Sin URL, sin credencial, sin la pregunta. */
const OPERACION = "asistente";

/**
 * Techo de la respuesta: acota el gasto. Era 1024 y CORTABA a media frase una respuesta que
 * enumera tres casos (medido en la ficha 457, §11.4 de `progress/impl_457.md`: «¿cómo anulo un pago
 * de una tienda?» se truncó las dos veces, `tokens salida 1024`). 2048 le da aire sin abrir la puerta
 * a respuestas largas: las instrucciones del sistema siguen pidiendo brevedad.
 */
const MAX_TOKENS_DEFAULT = 2048;

export interface AnthropicAsistenteOpts {
  /** La credencial. `null` -> desenlace `sin_credencial` y `fetchImpl` NO se llama (R20). */
  apiKey: string | null;
  modelo: string;
  timeoutMs?: number;
  /** `fetch` inyectable: los tests no tocan la red. */
  fetchImpl?: typeof fetch;
  maxTokens?: number;
}

/** Un bloque de texto del `system`, con su `cache_control` opcional. */
interface BloqueSistema {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/**
 * ⭑ EL `system` DE LA PETICIÓN: las instrucciones primero, y luego UN BLOQUE POR DOCUMENTO.
 *
 * ⚠️ EL `cache_control` VA EN EL ÚLTIMO BLOQUE DE DOCUMENTACIÓN Y EN NINGÚN OTRO (R6/D9). Marca
 * el final del prefijo cacheable: todo lo anterior —instrucciones + los 33 documentos de ese
 * rol— se reutiliza entre consultas. Ponerlo en varios bloques costaría varios puntos de caché
 * sin ganar nada; ponerlo en el primero dejaría la documentación fuera del prefijo, que es lo
 * único que de verdad pesa.
 *
 * SIN DOCUMENTOS NO HAY NADA QUE CACHEAR, y entonces no se emite ningún `cache_control`: marcar
 * las instrucciones sueltas crearía un punto de caché de cuatro líneas que no se amortiza nunca.
 */
export function bloquesDeSistema(consulta: ConsultaAsistente): BloqueSistema[] {
  const bloques: BloqueSistema[] = [{ type: "text", text: consulta.instrucciones }];
  consulta.documentos.forEach((doc, i) => {
    const bloque: BloqueSistema = { type: "text", text: textoDeDocumento(doc) };
    if (i === consulta.documentos.length - 1) bloque.cache_control = { type: "ephemeral" };
    bloques.push(bloque);
  });
  return bloques;
}

/**
 * Cómo se rotula un documento para el modelo. El slug va ESCRITO porque es lo que el modelo tiene
 * que devolver en la cita (`[[doc:<slug>]]`): si no lo viera, lo adivinaría a partir del título y
 * la validación de R24 descartaría casi todas las citas.
 */
function textoDeDocumento(doc: DocumentoContexto): string {
  return `# Documento ${doc.slug} — ${doc.titulo}\n\n${doc.cuerpo}`;
}

/** Un turno de la conversación, en la forma que espera el proveedor. */
function mensajeDeProveedor(mensaje: MensajeAsistente) {
  const contenido: Record<string, unknown>[] = [];
  for (const imagen of mensaje.imagenes ?? []) {
    contenido.push({
      type: "image",
      source: { type: "base64", media_type: imagen.medio, data: imagen.datosBase64 },
    });
  }
  contenido.push({ type: "text", text: mensaje.texto });
  return { role: mensaje.autor === "usuario" ? "user" : "assistant", content: contenido };
}

/**
 * ⭑ EL CUERPO DE LA PETICIÓN. Se exporta porque es lo que afirman R4 y R6: un test lo construye
 * y comprueba que `"tools" in cuerpo === false`, que no hay `thinking`, y que hay EXACTAMENTE un
 * `cache_control` y está en el último bloque de documentación.
 *
 * ⚠️ **SIN `tools`, y no por omisión** (D3/R4). El asistente no ejecuta nada: no asigna, no
 * gestiona, no cierra. La forma de garantizarlo no es confiar en el texto de sistema —un texto se
 * puede rodear— sino no darle la capacidad: sin `tools` en la petición, no hay nada que llamar.
 *
 * ⚠️ **SIN `thinking`** (D7). El pensamiento extendido multiplica el coste por respuesta y aquí
 * no hay nada que razonar en varios pasos: la respuesta está escrita en un documento o no está.
 */
export function cuerpoDePeticion(
  consulta: ConsultaAsistente,
  opts: { modelo: string; maxTokens: number },
): Record<string, unknown> {
  return {
    model: opts.modelo,
    max_tokens: opts.maxTokens,
    stream: true,
    system: bloquesDeSistema(consulta),
    messages: consulta.mensajes.map(mensajeDeProveedor),
  };
}

// --- Validación en el borde de lo que devuelve el proveedor -------------------------------

/**
 * SIN `.loose()`/`.passthrough()`, que es la convención del repo (`lib/auth/google-sa-token.ts`):
 * lo que no se lee se descarta en el borde y no sigue circulando. De la respuesta del proveedor
 * sólo interesan el texto que llega y el consumo que declara.
 */
const usoSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
});

const eventoSchema = z.object({
  type: z.string(),
  delta: z.object({ type: z.string().optional(), text: z.string().optional() }).optional(),
  message: z.object({ usage: usoSchema.optional() }).optional(),
  usage: usoSchema.optional(),
});

/**
 * Convierte el cuerpo SSE del proveedor en trozos nuestros.
 *
 * Es un generador y no un callback a propósito (design §1.1): el borde necesita poder CORTAR
 * —el usuario cierra el panel— y un iterador se cancela solo al salir del `for await`, sin que
 * haya que inventar un `cancelar()` que alguien olvidará llamar.
 */
async function* trozosDeSse(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<TrozoProveedor> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";
  let tokensEntrada = 0;
  let tokensSalida = 0;
  let tokensCacheLectura = 0;

  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      pendiente += decodificador.decode(value, { stream: true });

      const lineas = pendiente.split("\n");
      pendiente = lineas.pop() ?? "";

      for (const linea of lineas) {
        const limpia = linea.trim();
        if (!limpia.startsWith("data:")) continue;
        const crudo = limpia.slice("data:".length).trim();
        if (crudo === "" || crudo === "[DONE]") continue;

        let json: unknown;
        try {
          json = JSON.parse(crudo);
        } catch {
          // Un evento ilegible se ignora: no se propaga ni se adivina. El resto del stream
          // sigue siendo bueno y cortar la respuesta entera por una línea rota sería peor.
          continue;
        }
        const leido = eventoSchema.safeParse(json);
        if (!leido.success) continue;
        const evento = leido.data;

        const uso = evento.message?.usage ?? evento.usage;
        if (uso) {
          tokensEntrada = uso.input_tokens ?? tokensEntrada;
          tokensSalida = uso.output_tokens ?? tokensSalida;
          tokensCacheLectura = uso.cache_read_input_tokens ?? tokensCacheLectura;
        }

        if (evento.type === "content_block_delta" && typeof evento.delta?.text === "string") {
          yield { tipo: "texto", texto: evento.delta.text };
        }
      }
    }
  } finally {
    // Si quien consume abandona el `for await` (panel cerrado), esto suelta la conexión en vez
    // de dejarla abierta hasta el timeout.
    await lector.cancel().catch(() => undefined);
  }

  yield { tipo: "fin", tokensEntrada, tokensSalida, tokensCacheLectura };
}

export class AnthropicAsistenteClient implements IAsistenteProvider {
  private readonly apiKey: string | null;
  private readonly modelo: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxTokens: number;

  constructor(opts: AnthropicAsistenteOpts) {
    this.apiKey = opts.apiKey;
    this.modelo = opts.modelo;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxTokens = opts.maxTokens ?? MAX_TOKENS_DEFAULT;
  }

  async responder(consulta: ConsultaAsistente): Promise<RespuestaAsistente> {
    // R20 — SIN CREDENCIAL NO SE LLAMA A NADIE. Es un desenlace, no una excepción ni un 500
    // mudo: quien llama decide qué contarle a la persona.
    if (this.apiKey === null || this.apiKey === "") return { status: "sin_credencial" };

    const cuerpo = cuerpoDePeticion(consulta, {
      modelo: this.modelo,
      maxTokens: this.maxTokens,
    });

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // ⚠️ El error se DESCARTA a propósito y no se reenvía hacia arriba: un `AggregateError` de
      // `fetch` lleva la URL dentro, y de ahí llegaría al usuario (R21).
      return { status: "transitorio", detalle: `${OPERACION}: fallo de red o timeout` };
    }

    if (respuesta.status === 401 || respuesta.status === 403) {
      return {
        status: "config_invalida",
        detalle: `${OPERACION}: credencial rechazada (HTTP ${respuesta.status})`,
      };
    }
    if (respuesta.status === 429 || respuesta.status >= 500) {
      return { status: "transitorio", detalle: `${OPERACION}: HTTP ${respuesta.status}` };
    }
    if (!respuesta.ok) {
      // Un 400 aquí suele ser el nombre del modelo o un bloque mal formado. El cuerpo del
      // proveedor NO se lee ni se reenvía: puede repetir la petición entera, imágenes incluidas.
      return {
        status: "config_invalida",
        detalle: `${OPERACION}: el proveedor rechazó la petición (HTTP ${respuesta.status})`,
      };
    }
    if (respuesta.body === null) {
      return { status: "transitorio", detalle: `${OPERACION}: respuesta sin cuerpo` };
    }

    return { status: "ok", trozos: trozosDeSse(respuesta.body) };
  }
}
