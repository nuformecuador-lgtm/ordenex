import { describe, it, expect } from "vitest";

import { AnthropicAsistenteClient } from "@/lib/clients/anthropic-asistente";
import { ASISTENTE_MODELO_DEFAULT } from "@/lib/config/asistente";
import { instruccionesDelSistema } from "@/lib/asistente/instrucciones";
import type {
  ConsultaAsistente,
  TrozoProveedor,
} from "@/lib/interfaces/external/IAsistenteProvider";

/**
 * ⭑ FICHA 436 · R4 y R6 — LA FORMA DE LA PETICIÓN QUE SALE DE CASA.
 *
 * Se mide sobre el CUERPO REAL que el adaptador manda, capturado con un `fetch` inyectado. No
 * sobre un objeto que el test construya: eso demostraría que un objeto inventado no tiene `tools`.
 *
 * NI UNA LÍNEA DE ESTE ARCHIVO TOCA LA RED.
 */

interface Capturado {
  url: string;
  cuerpo: Record<string, unknown>;
  cabeceras: Record<string, string>;
}

/** Un `fetch` que apunta lo que le piden y devuelve un stream SSE mínimo pero legal. */
function fetchEspia(capturas: Capturado[], sse = "data: {\"type\":\"message_stop\"}\n\n") {
  return (async (url: unknown, init: unknown) => {
    const opciones = init as { body: string; headers: Record<string, string> };
    capturas.push({
      url: String(url),
      cuerpo: JSON.parse(opciones.body) as Record<string, unknown>,
      cabeceras: opciones.headers,
    });
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }) as unknown as typeof fetch;
}

const consulta: ConsultaAsistente = {
  instrucciones: instruccionesDelSistema("mensajero"),
  documentos: [
    { slug: "mensajero/reparto", titulo: "Reparto", cuerpo: "Cómo se reparte." },
    { slug: "mensajero/recoleccion", titulo: "Recolección", cuerpo: "Cómo se recoge." },
    { slug: "publico/rastreo-de-paquete", titulo: "Rastreo", cuerpo: "Cómo se rastrea." },
  ],
  mensajes: [{ autor: "usuario", texto: "¿cómo cierro el día?" }],
};

async function pedir(consultaDeLaVez: ConsultaAsistente = consulta) {
  const capturas: Capturado[] = [];
  const cliente = new AnthropicAsistenteClient({
    apiKey: "clave-de-mentira",
    modelo: ASISTENTE_MODELO_DEFAULT,
    fetchImpl: fetchEspia(capturas),
  });
  const respuesta = await cliente.responder(consultaDeLaVez);
  return { capturas, respuesta };
}

describe("R4 — la petición va SIN herramientas y SIN pensamiento extendido", () => {
  it("⭑ `tools` NO ESTÁ en el cuerpo (no es que esté vacío: es que no existe)", async () => {
    const { capturas } = await pedir();

    expect(capturas).toHaveLength(1);
    // `'tools' in cuerpo === false` y no `toBeUndefined()`: un `tools: []` también sería
    // `undefined`-ish a ojos de una aserción floja, y aquí la propiedad que importa es que el
    // proveedor NO RECIBA NINGÚN campo de herramientas. Sin `tools` no hay nada que llamar, y eso
    // es lo que hace que «no ejecuta nada» sea una garantía y no una promesa del texto de sistema.
    expect("tools" in capturas[0].cuerpo).toBe(false);
    expect("tool_choice" in capturas[0].cuerpo).toBe(false);
  });

  it("⭑ `thinking` tampoco (D7: sin pensamiento extendido)", async () => {
    const { capturas } = await pedir();
    expect("thinking" in capturas[0].cuerpo).toBe(false);
  });

  it("va el modelo decidido, en streaming, y con un techo de respuesta", async () => {
    const { capturas } = await pedir();
    expect(capturas[0].cuerpo.model).toBe(ASISTENTE_MODELO_DEFAULT);
    expect(capturas[0].cuerpo.stream).toBe(true);
    expect(typeof capturas[0].cuerpo.max_tokens).toBe("number");
  });

  it("CONTROL: el cuerpo tiene lo que SÍ debe tener (si no, «no está tools» sería vacuo)", async () => {
    const { capturas } = await pedir();
    // Sin este caso, un adaptador que mandara `{}` pasaría los dos de arriba en verde.
    expect(Array.isArray(capturas[0].cuerpo.system)).toBe(true);
    expect(Array.isArray(capturas[0].cuerpo.messages)).toBe(true);
    expect((capturas[0].cuerpo.messages as unknown[]).length).toBe(1);
  });
});

describe("R6 — el `cache_control` marca el final del bloque de documentación", () => {
  it("⭑ hay EXACTAMENTE UNO, y es `ephemeral`", async () => {
    const { capturas } = await pedir();
    const bloques = capturas[0].cuerpo.system as { text: string; cache_control?: unknown }[];

    const conCache = bloques.filter((b) => b.cache_control !== undefined);
    expect(conCache).toHaveLength(1);
    expect(conCache[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("⭑ y está en el ÚLTIMO bloque de documentación, no en el primero ni en las instrucciones", async () => {
    const { capturas } = await pedir();
    const bloques = capturas[0].cuerpo.system as { text: string; cache_control?: unknown }[];

    // El primer bloque son las instrucciones; los demás, un documento cada uno.
    expect(bloques).toHaveLength(1 + consulta.documentos.length);
    expect(bloques[0].text).toBe(instruccionesDelSistema("mensajero"));
    expect(bloques[0].cache_control).toBeUndefined();

    const ultimo = bloques[bloques.length - 1];
    expect(ultimo.cache_control).toEqual({ type: "ephemeral" });
    // Y el último es el último DOCUMENTO, no otra cosa: el prefijo cacheado son las
    // instrucciones + todos los documentos de ese rol.
    expect(ultimo.text).toContain(consulta.documentos[consulta.documentos.length - 1].slug);
  });

  it("cada documento va en su bloque, rotulado con el slug que el modelo tiene que citar", async () => {
    const { capturas } = await pedir();
    // `.slice(1)` salta el bloque de instrucciones: ahí dentro vive el EJEMPLO del formato de
    // cita (`[[doc:mensajero/reparto]]`), así que buscar el slug en todos los bloques encontraría
    // las instrucciones y el caso pasaría sin haber mirado ningún documento.
    const bloques = (capturas[0].cuerpo.system as { text: string }[]).slice(1);

    for (const doc of consulta.documentos) {
      const suyo = bloques.find((b) => b.text.includes(doc.slug));
      expect(suyo, `falta el bloque de ${doc.slug}`).toBeDefined();
      expect(suyo!.text).toContain(doc.cuerpo);
    }
  });

  it("SIN documentos no se emite ningún `cache_control` (no hay prefijo que cachear)", async () => {
    const { capturas } = await pedir({ ...consulta, documentos: [] });
    const bloques = capturas[0].cuerpo.system as { cache_control?: unknown }[];
    expect(bloques).toHaveLength(1);
    expect(bloques.filter((b) => b.cache_control !== undefined)).toEqual([]);
  });
});

describe("el stream se lee por trozos y el consumo llega hasta arriba", () => {
  it("un `content_block_delta` por evento produce un trozo de texto", async () => {
    const capturas: Capturado[] = [];
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":21000,"cache_read_input_tokens":20800}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Para cerrar"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" el día…"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":42}}',
      'data: {"type":"message_stop"}',
      "",
    ].join("\n\n");

    const cliente = new AnthropicAsistenteClient({
      apiKey: "clave-de-mentira",
      modelo: ASISTENTE_MODELO_DEFAULT,
      fetchImpl: fetchEspia(capturas, sse),
    });
    const respuesta = await cliente.responder(consulta);
    expect(respuesta.status).toBe("ok");

    const recibidos: TrozoProveedor[] = [];
    if (respuesta.status === "ok") for await (const t of respuesta.trozos) recibidos.push(t);

    expect(recibidos.filter((t) => t.tipo === "texto").map((t) => (t as { texto: string }).texto))
      .toEqual(["Para cerrar", " el día…"]);
    const fin = recibidos[recibidos.length - 1];
    expect(fin).toEqual({
      tipo: "fin",
      tokensEntrada: 21000,
      tokensSalida: 42,
      // La medida de si el `cache_control` está sirviendo de algo. Un cero sostenido aquí en
      // producción significa que el prefijo cambia en cada consulta y se está pagando entero.
      tokensCacheLectura: 20800,
    });
  });

  it("un evento ilegible se ignora y el resto del stream sigue siendo bueno", async () => {
    const capturas: Capturado[] = [];
    const sse = [
      "data: {esto no es json}",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"sigo aquí"}}',
      'data: {"type":"message_stop"}',
      "",
    ].join("\n\n");
    const cliente = new AnthropicAsistenteClient({
      apiKey: "x",
      modelo: "m",
      fetchImpl: fetchEspia(capturas, sse),
    });
    const respuesta = await cliente.responder(consulta);
    const textos: string[] = [];
    if (respuesta.status === "ok") {
      for await (const t of respuesta.trozos) if (t.tipo === "texto") textos.push(t.texto);
    }
    expect(textos).toEqual(["sigo aquí"]);
  });
});
