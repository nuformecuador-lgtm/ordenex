import { describe, it, expect } from "vitest";

import { handleAsistente } from "@/app/api/asistente/route";
import { MSG } from "@/lib/errors";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { AsistenteService } from "@/lib/services/AsistenteService";
import { cuerpoDePeticion } from "@/lib/clients/anthropic-asistente";
import {
  ASISTENTE_IMAGENES_MAX_POR_MENSAJE,
  ASISTENTE_IMAGENES_MAX_POR_PETICION,
  ASISTENTE_IMAGEN_MAX_BASE64,
  ASISTENTE_IMAGEN_MAX_BYTES,
  ASISTENTE_IMAGEN_MEDIOS,
} from "@/lib/config/asistente";
import type { IAsistenteUsoRepository } from "@/lib/interfaces/repositories/IAsistenteUsoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { DobleProveedor } from "../unit/asistente/_doble-proveedor";

/**
 * ⭑ FICHA 436 · D12 y Q6 — IMÁGENES SÍ, AUDIO NO; UNA POR MENSAJE, HASTA 5 MB, Y CUENTA UNA.
 *
 * ⚠️ POR QUÉ ESTE ARCHIVO EXISTE APARTE DE R29. R29 es del PANEL: «hay control de imagen y no hay
 * control de audio». Pero un control de pantalla no protege nada por sí solo — quien mande la
 * petición a mano se salta la pantalla entera—. Lo que de verdad decide qué entra es el `zod` del
 * borde, y eso es lo que se mide aquí. Es la misma lección de R7/R8: lo que manda el cliente no
 * decide; decide el servidor.
 *
 * El tope de 5 MB no es un número nuevo: es `GESTION_MAX_FILE_BYTES`, el que este repo ya usa para
 * la evidencia de gestión (Q6). Inventar un segundo límite para lo mismo es cómo se acaba con dos
 * topes y nadie sabiendo cuál manda.
 */

const MENSAJERO: Actor = { usuarioId: "u-mensajero", rol: "mensajero", zonaId: null };

/** Un contador que apunta cuántas veces se le pidió consumir. */
function usoQueCuenta() {
  const llamadas: { usuarioId: string; fecha: string }[] = [];
  const repo: IAsistenteUsoRepository = {
    consumirUnaConsulta: async (usuarioId, fecha) => {
      llamadas.push({ usuarioId, fecha });
      return llamadas.length;
    },
    contarNoLoSe: async () => undefined,
  };
  return { repo, llamadas };
}

function peticion(cuerpo: unknown): Request {
  return new Request("https://app.test/api/asistente", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

async function llamar(cuerpo: unknown, uso = usoQueCuenta()) {
  const proveedor = new DobleProveedor();
  const res = await handleAsistente(peticion(cuerpo), {
    getActor: async () => MENSAJERO,
    service: new AsistenteService({
      proveedor,
      usoRepo: uso.repo,
      leerCatalogo: leerCatalogoAyuda,
      maxConsultasDia: 30,
    }),
  });
  // El cuerpo se consume SIEMPRE —un stream sin leer deja el generador a medias— y se devuelve,
  // porque hay casos que miran lo que dice el rechazo y `res.json()` ya no se podría llamar.
  const texto = res.body ? await res.text() : "";
  return { res, proveedor, uso, texto };
}

/** Un PNG de un pixel, en base64. Pequeño de verdad: no hay que inventar bytes. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const conImagen = (medio: string, datos = PNG_1PX) => ({
  mensajes: [{ autor: "usuario", texto: "¿qué es esta pantalla?", imagenes: [{ medio, datosBase64: datos }] }],
});

describe("D12 — una imagen entra, y llega ENTERA al proveedor", () => {
  it("⭑ un PNG adjunto viaja con su tipo de medio y sus datos intactos", async () => {
    const { res, proveedor } = await llamar(conImagen("image/png"));

    expect(res.status).toBe(200);
    expect(proveedor.llamadas[0].mensajes[0].imagenes).toEqual([
      { medio: "image/png", datosBase64: PNG_1PX },
    ]);
  });

  it("⭑ y el adaptador la pone en la petición en la forma que el proveedor espera", async () => {
    // Se mide sobre el cuerpo REAL que construye el adaptador, no sobre el puerto: entre los dos
    // hay una traducción (bloque `image` con `source.base64`) que nadie más comprueba.
    const cuerpo = cuerpoDePeticion(
      {
        instrucciones: "x",
        documentos: [],
        mensajes: [
          { autor: "usuario", texto: "mirá", imagenes: [{ medio: "image/png", datosBase64: PNG_1PX }] },
        ],
      },
      { modelo: "m", maxTokens: 10 },
    );
    const mensajes = cuerpo.messages as { role: string; content: Record<string, unknown>[] }[];
    expect(mensajes[0].role).toBe("user");
    expect(mensajes[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: PNG_1PX },
    });
    // Y el texto va DESPUÉS de la imagen: primero se ve la captura, luego la pregunta sobre ella.
    expect(mensajes[0].content[1]).toEqual({ type: "text", text: "mirá" });
  });

  it("los tres formatos de la lista blanca se aceptan", async () => {
    for (const medio of ASISTENTE_IMAGEN_MEDIOS) {
      const { res } = await llamar(conImagen(medio));
      expect(res.status, medio).toBe(200);
    }
  });

  it("⭑ y cuenta como UNA consulta, ni más ni menos (Q6: el tope mide preguntas, no bytes)", async () => {
    const uso = usoQueCuenta();
    await llamar(conImagen("image/png"), uso);
    expect(uso.llamadas).toHaveLength(1);
  });
});

describe("D12 — AUDIO NO. No es «no implementado»: es que no entra", () => {
  it("⭑⭑ un adjunto de audio se rechaza con 422, y el proveedor no se llama", async () => {
    // El modelo que responde NO transcribe voz. Un audio aceptado aquí sería una promesa falsa:
    // la persona manda una nota de voz, espera respuesta y no la hay.
    for (const medio of ["audio/mpeg", "audio/ogg", "audio/webm", "audio/mp4"]) {
      const { res, proveedor } = await llamar(conImagen(medio));
      expect(res.status, medio).toBe(422);
      expect(proveedor.llamadas, medio).toEqual([]);
    }
  });

  it("y tampoco entra un PDF, un vídeo ni un `image/*` comodín: es LISTA BLANCA", async () => {
    for (const medio of ["application/pdf", "video/mp4", "image/*", "image/gif", "image/svg+xml"]) {
      expect((await llamar(conImagen(medio))).res.status, medio).toBe(422);
    }
  });
});

describe("Q6 — una por mensaje, y hasta 5 MB", () => {
  it("CONTROL: los números son los decididos (5 MB, el de la evidencia de gestión; y una)", () => {
    expect(ASISTENTE_IMAGEN_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(ASISTENTE_IMAGENES_MAX_POR_MENSAJE).toBe(1);
    // El tope se aplica sobre la CADENA base64, que es como la imagen viaja: medir bytes exigiría
    // decodificar primero, o sea aceptar antes de comprobar.
    expect(ASISTENTE_IMAGEN_MAX_BASE64).toBeGreaterThan(ASISTENTE_IMAGEN_MAX_BYTES);
  });

  it("⭑ DOS imágenes en el mismo mensaje se rechazan", async () => {
    const { res, proveedor } = await llamar({
      mensajes: [
        {
          autor: "usuario",
          texto: "mirá estas dos",
          imagenes: [
            { medio: "image/png", datosBase64: PNG_1PX },
            { medio: "image/png", datosBase64: PNG_1PX },
          ],
        },
      ],
    });
    expect(res.status).toBe(422);
    expect(proveedor.llamadas).toEqual([]);
  });

  it("⭑ una imagen por ENCIMA del tope se rechaza, y no llega al proveedor", async () => {
    // Se construye justo un carácter por encima del máximo: el caso del borde, no uno gigante.
    const demasiado = "A".repeat(ASISTENTE_IMAGEN_MAX_BASE64 + 1);
    const { res, proveedor } = await llamar(conImagen("image/png", demasiado));
    expect(res.status).toBe(422);
    expect(proveedor.llamadas).toEqual([]);
  });

  it("y una JUSTO en el tope sí pasa (si no, el caso de arriba pasaría con cualquier tope)", async () => {
    const justa = "A".repeat(ASISTENTE_IMAGEN_MAX_BASE64);
    expect((await llamar(conImagen("image/png", justa))).res.status).toBe(200);
  });

  it("un mensaje SIN imágenes sigue siendo válido (las imágenes son opcionales)", async () => {
    const { res } = await llamar({ mensajes: [{ autor: "usuario", texto: "¿cómo cierro?" }] });
    expect(res.status).toBe(200);
  });
});

describe("m3 — el coste de UNA consulta también está acotado: las imágenes de toda la petición", () => {
  /**
   * ⚠️ EL AGUJERO QUE CIERRA, medido en la revisión de la ficha. «Una imagen por mensaje» no acota
   * nada por sí solo: la conversación vive en el cliente (D10) y **viaja entera en cada pregunta**,
   * así que con 40 mensajes admitidos cabían 40 imágenes en UNA petición. Van en `messages`, fuera
   * del prefijo cacheado, o sea que se pagan enteras cada vez. El tope diario cuenta preguntas; lo
   * único que acotaba el coste de una pregunta era el límite de cuerpo de Vercel — plataforma, no
   * código, y en local ni existe.
   */
  const hilo = (cuantas: number) => ({
    mensajes: Array.from({ length: cuantas }, (_, i) => ({
      autor: "usuario",
      texto: `pregunta ${i + 1}`,
      imagenes: [{ medio: "image/png", datosBase64: PNG_1PX }],
    })),
  });

  it("CONTROL: el número es el decidido, y es de PETICIÓN, no de mensaje", () => {
    expect(ASISTENTE_IMAGENES_MAX_POR_PETICION).toBe(4);
    expect(ASISTENTE_IMAGENES_MAX_POR_PETICION).toBeGreaterThan(ASISTENTE_IMAGENES_MAX_POR_MENSAJE);
  });

  it("⭑⭑ cinco mensajes con una imagen cada uno —cinco imágenes— se rechazan con 422", async () => {
    const { res, proveedor } = await llamar(hilo(ASISTENTE_IMAGENES_MAX_POR_PETICION + 1));

    expect(res.status).toBe(422);
    // Y NO SE LLAMÓ AL PROVEEDOR: la propiedad que importa es que el gasto no ocurre, no el código.
    expect(proveedor.llamadas).toEqual([]);
  });

  it("⭑ y el rechazo DICE QUÉ PASÓ: el número que cabe y qué hacer, no «datos inválidos»", async () => {
    // Un 422 con el mensaje genérico dejaría a la persona sin saber qué quitar. El panel pinta
    // este `message` tal cual (`AsistenteProvider`: los rechazos previos no se reescriben).
    const { texto } = await llamar(hilo(ASISTENTE_IMAGENES_MAX_POR_PETICION + 1));
    const cuerpo = JSON.parse(texto) as { code: string; message: string };

    expect(cuerpo.code).toBe("VALIDATION_ERROR");
    expect(cuerpo.message).toContain("demasiadas imágenes");
    expect(cuerpo.message).toContain("caben 4");
    expect(cuerpo.message).toContain("conversación nueva");
    expect(cuerpo.message).not.toBe(MSG.VALIDATION_ERROR);
  });

  it("⭑ y JUSTO en el tope sí pasa (si no, el caso de arriba pasaría con cualquier número)", async () => {
    const { res, proveedor } = await llamar(hilo(ASISTENTE_IMAGENES_MAX_POR_PETICION));
    expect(res.status).toBe(200);
    expect(proveedor.llamadas[0].mensajes).toHaveLength(ASISTENTE_IMAGENES_MAX_POR_PETICION);
  });

  it("una conversación larga SIN imágenes no se toca: lo que se cuenta son imágenes", async () => {
    // El tope de turnos sigue siendo otro (40) y esto no lo estrecha: quien conversa mucho y no
    // adjunta nada no se encuentra con ningún rechazo nuevo.
    const { res } = await llamar({
      mensajes: Array.from({ length: 20 }, (_, i) => ({ autor: "usuario", texto: `p${i}` })),
    });
    expect(res.status).toBe(200);
  });
});
