import { describe, it, expect, vi, afterEach } from "vitest";

import { AnthropicAsistenteClient } from "@/lib/clients/anthropic-asistente";
import { loadAsistenteConfig, ASISTENTE_MODELO_DEFAULT } from "@/lib/config/asistente";
import type { ConsultaAsistente } from "@/lib/interfaces/external/IAsistenteProvider";

/**
 * ⭑ FICHA 436 · R20 — SIN CREDENCIAL NO SE LLAMA A NADIE, Y NO ES UN 500 MUDO.
 *
 * La ausencia de credencial es un DESENLACE, no una excepción. Mismo criterio que
 * `lib/config/geocode.ts`: quien llama decide qué contarle a la persona. Un `throw` aquí
 * convertiría «falta una variable de entorno» en «el asistente revienta la pantalla».
 */

const consulta: ConsultaAsistente = {
  instrucciones: "instrucciones",
  documentos: [{ slug: "mensajero/reparto", titulo: "Reparto", cuerpo: "cuerpo" }],
  mensajes: [{ autor: "usuario", texto: "hola" }],
};

describe("R20 — el adaptador sin credencial", () => {
  it("⭑ devuelve `sin_credencial` y el `fetch` inyectado NO se llama", async () => {
    const fetchEspia = vi.fn();
    const cliente = new AnthropicAsistenteClient({
      apiKey: null,
      modelo: ASISTENTE_MODELO_DEFAULT,
      fetchImpl: fetchEspia as unknown as typeof fetch,
    });

    const respuesta = await cliente.responder(consulta);

    expect(respuesta).toEqual({ status: "sin_credencial" });
    // La mitad que de verdad importa: no se llamó a nadie. Sin esto, un adaptador que llamara
    // con `x-api-key: null` y tradujera el 401 a `sin_credencial` pasaría el caso de arriba.
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it("una credencial vacía cuenta como ausente (una variable declarada y sin valor)", async () => {
    const fetchEspia = vi.fn();
    const cliente = new AnthropicAsistenteClient({
      apiKey: "",
      modelo: ASISTENTE_MODELO_DEFAULT,
      fetchImpl: fetchEspia as unknown as typeof fetch,
    });

    expect(await cliente.responder(consulta)).toEqual({ status: "sin_credencial" });
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it("NO LANZA: el desenlace se devuelve, no se propaga como excepción", async () => {
    const cliente = new AnthropicAsistenteClient({ apiKey: null, modelo: "m" });
    // Sin `fetchImpl`: si esto llamara al `fetch` global saldría a la red. Que devuelva sin
    // lanzar y sin tocar nada es exactamente la propiedad.
    await expect(cliente.responder(consulta)).resolves.toEqual({ status: "sin_credencial" });
  });
});

describe("T5 — la configuración del asistente nunca lanza y cae a sus defaults", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sin ninguna variable: credencial `null` y los tres defaults", () => {
    // `undefined` BORRA la variable en vez de ponerla a "": es importante distinguirlo, porque en
    // Vercel una variable declarada y vacía es un caso real y distinto de una ausente.
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("ASISTENTE_MODELO", undefined);
    vi.stubEnv("ASISTENTE_MAX_CONSULTAS_DIA", undefined);
    vi.stubEnv("ASISTENTE_TIMEOUT_MS", undefined);

    expect(loadAsistenteConfig()).toEqual({
      ANTHROPIC_API_KEY: null,
      ASISTENTE_MODELO: "claude-sonnet-5",
      ASISTENTE_MAX_CONSULTAS_DIA: 30,
      ASISTENTE_TIMEOUT_MS: 60_000,
    });
  });

  it("un valor basura cae al default SIN LANZAR (no tumba la pantalla por una variable mal puesta)", () => {
    vi.stubEnv("ASISTENTE_MAX_CONSULTAS_DIA", "treinta");
    vi.stubEnv("ASISTENTE_TIMEOUT_MS", "-5");
    vi.stubEnv("ASISTENTE_MODELO", "");

    const config = loadAsistenteConfig();
    expect(config.ASISTENTE_MAX_CONSULTAS_DIA).toBe(30);
    expect(config.ASISTENTE_TIMEOUT_MS).toBe(60_000);
    expect(config.ASISTENTE_MODELO).toBe("claude-sonnet-5");
  });

  it("un valor válido SÍ manda (si no, los dos casos de arriba serían vacuos)", () => {
    vi.stubEnv("ASISTENTE_MAX_CONSULTAS_DIA", "5");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-de-mentira");
    const config = loadAsistenteConfig();
    expect(config.ASISTENTE_MAX_CONSULTAS_DIA).toBe(5);
    expect(config.ANTHROPIC_API_KEY).toBe("sk-de-mentira");
  });
});
