import { describe, it, expect } from "vitest";

import { AnthropicAsistenteClient } from "@/lib/clients/anthropic-asistente";
import type { ConsultaAsistente } from "@/lib/interfaces/external/IAsistenteProvider";

/**
 * ⭑ FICHA 436 · R21 — UN FALLO DEL PROVEEDOR NO ARRASTRA LA CREDENCIAL, LA URL NI SU TEXTO CRUDO.
 *
 * POR QUÉ NO ES PARANOIA. El camino natural de un adaptador es reenviar hacia arriba el error que
 * recibió, y aquí ese error puede llevar tres cosas que no deben salir de casa:
 *
 *  1. **La credencial**, porque un `AggregateError` de `fetch` o un mensaje del proveedor pueden
 *     repetir la cabecera de la petición.
 *  2. **La URL del proveedor**, que le dice a cualquiera qué servicio hay detrás.
 *  3. **El cuerpo crudo del error**, que en esta API puede repetir LA PETICIÓN ENTERA — es decir,
 *     la pregunta de la persona y hasta la imagen que adjuntó, de vuelta en una pantalla o en un
 *     log de terceros.
 *
 * La credencial de abajo es un literal reconocible: si aparece en cualquier `detalle`, el test lo
 * ve. La verificación se hace sobre TODO el texto del desenlace, no sobre una subcadena elegida.
 */

const CREDENCIAL = "sk-ant-CREDENCIAL-RECONOCIBLE-0001";
const HOST = "api.anthropic.com";

const consulta: ConsultaAsistente = {
  instrucciones: "instrucciones",
  documentos: [{ slug: "mensajero/reparto", titulo: "Reparto", cuerpo: "cuerpo" }],
  mensajes: [{ autor: "usuario", texto: "la pregunta de la persona" }],
};

/** Todo el texto que sale del desenlace, sea cual sea su forma. */
function textoDelDesenlace(valor: unknown): string {
  return JSON.stringify(valor);
}

function clienteCon(fetchImpl: typeof fetch) {
  return new AnthropicAsistenteClient({
    apiKey: CREDENCIAL,
    modelo: "claude-sonnet-5",
    fetchImpl,
  });
}

/** Una respuesta de error cuyo cuerpo repite la credencial, la URL y la pregunta. */
function respuestaDeError(status: number): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        message: `invalid x-api-key ${CREDENCIAL} at https://${HOST}/v1/messages`,
        request: consulta.mensajes[0].texto,
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("R21 — nada de lo que el proveedor dice llega al usuario", () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    it(`HTTP ${status}: el desenlace no cita credencial, URL ni el cuerpo del proveedor`, async () => {
      const cliente = clienteCon((async () => respuestaDeError(status)) as unknown as typeof fetch);

      const respuesta = await cliente.responder(consulta);
      const texto = textoDelDesenlace(respuesta);

      expect(respuesta.status === "transitorio" || respuesta.status === "config_invalida").toBe(
        true,
      );
      expect(texto, "la credencial se escapó").not.toContain(CREDENCIAL);
      expect(texto, "la URL del proveedor se escapó").not.toContain(HOST);
      expect(texto, "la pregunta de la persona volvió en el error").not.toContain(
        consulta.mensajes[0].texto,
      );
      // Y dice algo útil: el modo de fallo contrario —un mensaje vacío— tampoco sirve.
      expect(texto).toContain("asistente");
      expect(texto).toContain(String(status));
    });
  }

  it("⭑ un fallo de red: el error original lleva la URL dentro y NO se reenvía", async () => {
    const cliente = clienteCon((async () => {
      // Esto es lo que de verdad lanza `fetch` cuando no puede conectar: un error cuyo mensaje
      // nombra el destino. Reenviarlo tal cual es el fallo que este caso impide.
      throw new Error(`fetch failed: connect ECONNREFUSED https://${HOST}/v1/messages`);
    }) as unknown as typeof fetch);

    const respuesta = await cliente.responder(consulta);
    const texto = textoDelDesenlace(respuesta);

    expect(respuesta.status).toBe("transitorio");
    expect(texto).not.toContain(HOST);
    expect(texto).not.toContain("ECONNREFUSED");
    expect(texto).toContain("fallo de red o timeout");
  });

  it("un 2xx sin cuerpo tampoco revienta ni filtra", async () => {
    const cliente = clienteCon((async () =>
      new Response(null, { status: 204 })) as unknown as typeof fetch);
    const respuesta = await cliente.responder(consulta);
    expect(respuesta.status).toBe("transitorio");
    expect(textoDelDesenlace(respuesta)).not.toContain(CREDENCIAL);
  });

  it("CONTROL: la credencial SÍ viaja en la cabecera de la petición (si no, todo lo de arriba sería vacuo)", async () => {
    // Sin este control, un adaptador que no mandara la credencial pasaría los seis casos de arriba
    // por no tener nada que filtrar — y no funcionaría en producción.
    let cabeceras: Record<string, string> = {};
    const cliente = clienteCon((async (_url: unknown, init: unknown) => {
      cabeceras = (init as { headers: Record<string, string> }).headers;
      return respuestaDeError(500);
    }) as unknown as typeof fetch);

    await cliente.responder(consulta);
    expect(cabeceras["x-api-key"]).toBe(CREDENCIAL);
  });
});
