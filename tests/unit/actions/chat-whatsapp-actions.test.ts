import { describe, it, expect, vi } from "vitest";
import { enviarMensajeChat, listarHiloChat } from "@/lib/actions/chat-whatsapp";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { OrdenEnvioData } from "@/lib/types/whatsapp-envio";

// Feature 109 — F1.T/F2.T (R16/R17/R20/R21). Server Actions del chat: scope por
// OrdenEnvioReader (R17/R16), persistencia del saliente (R20) y manejo de transitorio (R21).

const MENSAJERO: Actor = { usuarioId: "men-1", rol: "mensajero" };
const getActor = (a: Actor | null) => async () => a;

const ORDEN_DATA: OrdenEnvioData = {
  destinatario: "Ana",
  telefonoDest: "573001112233",
  numGuia: 10,
  numRemision: "R-1",
  producto: "caja",
  direccion: "calle 1",
  montoCobrar: 100,
};

function ordenReader(data: OrdenEnvioData | null): IOrdenEnvioReader {
  return { findParaEnvio: vi.fn(async () => data) };
}

describe("enviarMensajeChat (R17/R20/R21)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const res = await enviarMensajeChat("orden-1", "hola", { getActor: getActor(null) });
    expect(res).toEqual({ status: "unauthenticated" });
  });

  it("R17: rechaza (forbidden) si la orden no esta asignada al actor, sin enviar", async () => {
    const service = { enviarTexto: vi.fn() } as unknown as ChatWhatsappService;
    const res = await enviarMensajeChat("orden-1", "hola", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(null), // no asignada
      service,
    });
    expect(res).toEqual({ status: "forbidden" });
    expect((service.enviarTexto as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("R20: ok -> devuelve el mensajeChatId del saliente persistido", async () => {
    const service = {
      enviarTexto: vi.fn(async () => ({ status: "ok", mensajeId: "wamid.X", mensajeChatId: "msg-1" })),
    } as unknown as ChatWhatsappService;

    const res = await enviarMensajeChat("orden-1", "hola", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service,
    });

    expect(service.enviarTexto).toHaveBeenCalledWith({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573001112233",
      texto: "hola",
    });
    expect(res).toEqual({ status: "ok", mensajeChatId: "msg-1" });
  });

  it("R19/D2: fuera_ventana se propaga a la UI (exige plantilla)", async () => {
    const service = {
      enviarTexto: vi.fn(async () => ({ status: "fuera_ventana" })),
    } as unknown as ChatWhatsappService;
    const res = await enviarMensajeChat("orden-1", "hola", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service,
    });
    expect(res).toEqual({ status: "fuera_ventana" });
  });

  it("R21: transitorio se comunica sin filtrar el detalle (numero/secreto) a la UI", async () => {
    const service = {
      enviarTexto: vi.fn(async () => ({
        status: "transitorio",
        detalle: "enviar mensaje de whatsapp: HTTP 503",
        mensajeChatId: "msg-q",
      })),
    } as unknown as ChatWhatsappService;

    const res = await enviarMensajeChat("orden-1", "hola", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service,
    });

    expect(res).toEqual({ status: "transitorio", mensajeChatId: "msg-q" });
    expect(res).not.toHaveProperty("detalle"); // no se filtra el detalle a la UI
  });

  it("service null (sin credencial) -> no_configurado", async () => {
    const res = await enviarMensajeChat("orden-1", "hola", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service: null,
    });
    expect(res).toEqual({ status: "no_configurado" });
  });

  it("texto vacio -> forbidden (borde zod, no envia)", async () => {
    const service = { enviarTexto: vi.fn() } as unknown as ChatWhatsappService;
    const res = await enviarMensajeChat("orden-1", "   ", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service,
    });
    expect(res.status).toBe("forbidden");
  });
});

describe("listarHiloChat (R16/R22)", () => {
  function conv(hilo: {
    id: string;
    ultimoEntranteAt: Date | null;
  } | null): IChatConversacionRepository {
    return {
      resolverOrdenActivaPorNumero: vi.fn(),
      upsertParaOrden: vi.fn(),
      marcarUltimoEntrante: vi.fn(),
      findByOrdenParaMensajero: vi.fn(async () =>
        hilo === null
          ? null
          : {
              id: hilo.id,
              telefonoE164: "573",
              ordenId: "orden-1",
              mensajeroId: "men-1",
              ultimoEntranteAt: hilo.ultimoEntranteAt,
            },
      ),
      findById: vi.fn(),
    };
  }

  function mensajes(lista: unknown[]): IChatMensajeRepository {
    return {
      insertarEntranteIdempotente: vi.fn(),
      insertarSaliente: vi.fn(),
      actualizarEstadoPorWaMessageId: vi.fn(),
      reconciliarSaliente: vi.fn(),
      findById: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listarHilo: vi.fn(async () => lista as any),
    };
  }

  it("R16: orden de otro mensajero -> forbidden (nunca lee el hilo)", async () => {
    const res = await listarHiloChat("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(null),
    });
    expect(res).toEqual({ status: "forbidden" });
  });

  it("orden del mensajero sin hilo aun -> ok vacio, ventana cerrada", async () => {
    const res = await listarHiloChat("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: conv(null),
    });
    expect(res).toEqual({ status: "ok", ventanaAbierta: false, ultimoEntranteAt: null, mensajes: [] });
  });

  it("R22: devuelve el hilo con ventana abierta cuando el ultimo entrante es reciente", async () => {
    const ahora = new Date("2026-07-23T12:00:00.000Z");
    const reciente = new Date(ahora.getTime() - 60 * 60 * 1000);
    const res = await listarHiloChat("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: conv({ id: "hilo-1", ultimoEntranteAt: reciente }),
      mensajeRepo: mensajes([
        {
          id: "m1",
          direccion: "entrante",
          tipo: "texto",
          cuerpo: "hola",
          estado: null,
          ocurridoAt: reciente,
        },
      ]),
      now: () => ahora,
    });

    expect(res).toMatchObject({ status: "ok", ventanaAbierta: true });
    if (res.status === "ok") {
      expect(res.mensajes[0]).toMatchObject({ id: "m1", direccion: "entrante" });
      expect(res.mensajes[0].ocurridoAt).toBe(reciente.toISOString());
    }
  });

  it("R23: ventana cerrada cuando el ultimo entrante ocurrio hace >= 24 h", async () => {
    const ahora = new Date("2026-07-23T12:00:00.000Z");
    const viejo = new Date(ahora.getTime() - 25 * 60 * 60 * 1000);
    const res = await listarHiloChat("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: conv({ id: "hilo-1", ultimoEntranteAt: viejo }),
      mensajeRepo: mensajes([]),
      now: () => ahora,
    });
    expect(res).toMatchObject({ status: "ok", ventanaAbierta: false });
  });
});
