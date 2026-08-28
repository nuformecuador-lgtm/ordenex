import { describe, it, expect } from "vitest";
import type { ChatMensajeTipo } from "@prisma/client";
import type { TipoAdjuntoEnvio } from "@/lib/config/chat-media-envio";
import type { InsertarSalienteInput } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { EnviarMediaChatResult } from "@/lib/types/chat-whatsapp";

// Feature 316 — A0 y A2. Estos asserts los ejecuta el COMPILADOR: `pnpm typecheck` incluye
// `tests/**`, asi que una asignacion imposible o un `@ts-expect-error` que deje de fallar ponen
// el gate en rojo. Los `expect` de runtime existen para que vitest reporte el archivo.
//
// D1 (feature 316) ocupa ya el hueco reservado: el `switch` exhaustivo sobre
// `EnviarMediaChatResult` y el `@ts-expect-error` de `{ status: "transitorio" }`.

describe("A0: NO hace falta migracion — el enum ya admite los cuatro tipos de adjunto", () => {
  it("los cuatro tipos de adjunto de envio son asignables a ChatMensajeTipo", () => {
    // Si `db/schema.prisma` no tuviera `imagen|video|audio|documento` en el enum, esta linea no
    // compilaria. Es el assert que sustituye a "lo he leido en el schema": la premisa de
    // R17/R18 (persistir un saliente de adjunto SIN tocar el esquema) queda fijada aqui.
    const tipos: ChatMensajeTipo[] = ["imagen", "video", "audio", "documento"];
    expect(tipos).toHaveLength(4);

    // Y en la direccion util: cualquier `TipoAdjuntoEnvio` sirve como `tipo` del mensaje.
    const desdeClasificador: TipoAdjuntoEnvio = "documento";
    const comoTipoDeMensaje: ChatMensajeTipo = desdeClasificador;
    expect(comoTipoDeMensaje).toBe("documento");
  });

  it("ChatMensajeTipo NO gana tipos inventados por la 316", () => {
    // @ts-expect-error 'adjunto' no es un tipo del enum: el enum es la fuente, no la UI.
    const invalido: ChatMensajeTipo = "adjunto";
    expect(invalido).toBe("adjunto");
  });
});

describe("A2: InsertarSalienteInput gana SOLO los cuatro campos de media", () => {
  const base = {
    conversacionId: "hilo-1",
    tipo: "imagen" as const,
    cuerpo: "un pie",
    estado: "sent" as const,
    ocurridoAt: new Date("2026-08-28T10:00:00.000Z"),
  };

  it("admite los cuatro campos del adjunto propio (R17)", () => {
    const input: InsertarSalienteInput = {
      ...base,
      mediaId: "MEDIA-1",
      mediaMime: "image/jpeg",
      mediaNombre: "foto.jpg",
      mediaTamanoBytes: 1234,
    };
    expect(input.mediaId).toBe("MEDIA-1");
    expect(input.mediaTamanoBytes).toBe(1234);
  });

  it("NO admite los campos que solo tienen sentido en un entrante", () => {
    // El input de ESCRITURA de un saliente no puede ofrecer `reaccion*`/`contactos`/`sistema*`:
    // seria una puerta abierta a persistir un saliente imposible (design §1.1). Por eso se
    // declaran los cuatro campos a mano y no `Partial<ChatMensajeCamposMedia>` entero.
    const input: InsertarSalienteInput = {
      ...base,
      // @ts-expect-error un saliente de la 316 nunca es una reaccion.
      reaccionEmoji: "👍",
    };
    expect(input.tipo).toBe("imagen");
  });

  it("los campos de media son OPCIONALES: un saliente de texto no los declara", () => {
    const input: InsertarSalienteInput = {
      conversacionId: "hilo-1",
      tipo: "texto",
      cuerpo: "hola",
      estado: "sent",
      ocurridoAt: new Date(),
    };
    expect(input.mediaId).toBeUndefined();
  });
});


describe("D1: EnviarMediaChatResult cubre los desenlaces del adjunto y SOLO esos", () => {
  /**
   * `switch` EXHAUSTIVO sin `default`. Si el union gana un caso y no se anade aqui, el
   * `never` deja de compilar y `pnpm typecheck` se pone rojo: es el assert que impide que la
   * UI se quede sin tratar un desenlace nuevo.
   */
  function textoDe(res: EnviarMediaChatResult): string {
    switch (res.status) {
      case "ok":
        return `enviado:${res.mensajeChatId}`;
      case "unauthenticated":
        return "sesion caducada";
      case "forbidden":
        return "esta orden no es tuya";
      case "fuera_ventana":
        return "fuera de la ventana de 24 h";
      case "no_configurado":
        return "whatsapp sin configurar";
      case "tipo_no_permitido":
        return "ese tipo de archivo no se puede enviar";
      case "demasiado_grande":
        return `pasa del limite de ${res.limiteBytes} bytes`;
      case "caption_largo":
        return `el pie no puede pasar de ${res.maximo} caracteres`;
      case "fallo_subida":
        return "no se pudo subir el adjunto";
      case "permanente":
        return `rechazado: ${res.detalle}`;
      default: {
        const imposible: never = res;
        return imposible;
      }
    }
  }

  it("cada desenlace tiene su texto y los que llevan dato lo exponen", () => {
    expect(textoDe({ status: "ok", mensajeChatId: "msg-1" })).toBe("enviado:msg-1");
    expect(textoDe({ status: "demasiado_grande", limiteBytes: 5 })).toContain("5");
    expect(textoDe({ status: "caption_largo", maximo: 1024 })).toContain("1024");
    expect(textoDe({ status: "fallo_subida" })).toContain("subir");
  });

  it("NO existe `transitorio`: un adjunto no se encola (design 4.1)", () => {
    // Si alguien anadiera `transitorio` al union "por simetria con el texto", este
    // `@ts-expect-error` dejaria de fallar y el gate se pondria rojo. La UI no puede prometer
    // un reintento que no existe: el media id caduca y no hay copia propia del binario.
    // @ts-expect-error `transitorio` no es un desenlace posible de un envio de adjunto.
    const imposible: EnviarMediaChatResult = { status: "transitorio", mensajeChatId: "msg-1" };
    expect(imposible.status).toBe("transitorio");
  });

  it("NO existe `no_convertible`: ese desenlace es del composer, no del servidor (R31)", () => {
    // La normalizacion de imagen ocurre SOLO en el navegador; al servidor un HEIC le llega
    // como `tipo_no_permitido`. Meterlo aqui seria prometer un caso que no puede devolver.
    // @ts-expect-error `no_convertible` vive en el estado del composer, no en la accion.
    const imposible: EnviarMediaChatResult = { status: "no_convertible" };
    expect(imposible.status).toBe("no_convertible");
  });
});
