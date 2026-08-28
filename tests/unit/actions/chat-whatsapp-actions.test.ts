import { describe, it, expect, vi } from "vitest";
import {
  enviarMediaChat,
  enviarMensajeChat,
  enviarPlantillaChat,
  listarHiloChat,
  marcarChatLeido,
  resumenNoLeidosChat,
} from "@/lib/actions/chat-whatsapp";
import type { PlantillaEnviable } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { DatosPlantilla } from "@/lib/types/plantilla-datos";
import { datosPlantillaFixture } from "@/tests/fixtures/plantilla-datos";
import { MAX_CAPTION } from "@/lib/config/chat-media-envio";

// Feature 109 — F1.T/F2.T (R16/R17/R20/R21). Server Actions del chat: scope por
// OrdenEnvioReader (R17/R16), persistencia del saliente (R20) y manejo de transitorio (R21).

const MENSAJERO: Actor = { usuarioId: "men-1", rol: "mensajero" };
const getActor = (a: Actor | null) => async () => a;

const ORDEN_DATA: DatosPlantilla = datosPlantillaFixture({
  orden: {
    numGuia: 10,
    numRemision: "R-1",
    destinatario: "Ana",
    telefonoDest: "573001112233",
    producto: "caja",
    direccion: "calle 1",
    montoCobrar: 100,
  },
  mensajero: { nombre: "Carlos", primerApellido: null },
});

function ordenReader(data: DatosPlantilla | null): IOrdenEnvioReader {
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

describe("enviarPlantillaChat (envio de plantilla por el chat)", () => {
  const PLANTILLA: PlantillaEnviable = {
    id: "plt-1",
    nombre: "recordatorio_entrega",
    cuerpo: "Hola {{nombre}}, tu pedido llega hoy",
    variables: ["nombre"],
    templateId: "meta-tpl-1",
    templateIdioma: "es",
  };

  function plantillaRepo(p: PlantillaEnviable | null) {
    return { findEnviableById: vi.fn(async () => p) };
  }

  it("sin sesion -> unauthenticated", async () => {
    const res = await enviarPlantillaChat("orden-1", "plt-1", { getActor: getActor(null) });
    expect(res).toEqual({ status: "unauthenticated" });
  });

  it("rechaza (forbidden) si la orden no esta asignada al actor, sin enviar", async () => {
    const service = { enviarPlantilla: vi.fn() } as unknown as ChatWhatsappService;
    const res = await enviarPlantillaChat("orden-1", "plt-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(null),
      plantillaRepo: plantillaRepo(PLANTILLA),
      service,
    });
    expect(res).toEqual({ status: "forbidden" });
    expect((service.enviarPlantilla as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("plantilla inexistente / no enviable -> not_found, sin enviar", async () => {
    const service = { enviarPlantilla: vi.fn() } as unknown as ChatWhatsappService;
    const res = await enviarPlantillaChat("orden-1", "plt-x", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      plantillaRepo: plantillaRepo(null),
      service,
    });
    expect(res).toEqual({ status: "not_found" });
    expect((service.enviarPlantilla as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("ok: mapea variables->orden, construye componentes y persiste el saliente plantilla", async () => {
    const service = {
      enviarPlantilla: vi.fn(async () => ({
        status: "ok",
        mensajeId: "wamid.PLT",
        mensajeChatId: "msg-plt",
      })),
    } as unknown as ChatWhatsappService;

    const res = await enviarPlantillaChat("orden-1", "plt-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      plantillaRepo: plantillaRepo(PLANTILLA),
      service,
    });

    const arg = (service.enviarPlantilla as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573001112233",
      plantillaId: "plt-1",
      nombre: "recordatorio_entrega",
      idioma: "es",
      cuerpoRenderizado: "Hola Ana, tu pedido llega hoy", // {{nombre}} -> destinatario
    });
    // Componentes construidos a partir de las variables (formato Graph API).
    expect(arg.componentes).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]);
    expect(res).toEqual({ status: "ok", mensajeChatId: "msg-plt" });
  });

  it("se permite dentro Y fuera de la ventana: la action nunca devuelve fuera_ventana", async () => {
    const service = {
      enviarPlantilla: vi.fn(async () => ({ status: "ok", mensajeId: "w", mensajeChatId: "m" })),
    } as unknown as ChatWhatsappService;

    const res = await enviarPlantillaChat("orden-1", "plt-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      plantillaRepo: plantillaRepo(PLANTILLA),
      service,
    });
    expect(res.status).toBe("ok");
    expect(res).not.toHaveProperty("fuera_ventana");
  });

  it("transitorio: reintentable, sin filtrar el detalle (numero/secreto) a la UI", async () => {
    const service = {
      enviarPlantilla: vi.fn(async () => ({
        status: "transitorio",
        detalle: "enviar mensaje de whatsapp: HTTP 503",
        mensajeChatId: "msg-q",
      })),
    } as unknown as ChatWhatsappService;

    const res = await enviarPlantillaChat("orden-1", "plt-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      plantillaRepo: plantillaRepo(PLANTILLA),
      service,
    });

    expect(res).toEqual({ status: "transitorio", mensajeChatId: "msg-q" });
    expect(res).not.toHaveProperty("detalle");
  });

  it("service null (sin credencial) -> no_configurado", async () => {
    const res = await enviarPlantillaChat("orden-1", "plt-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      plantillaRepo: plantillaRepo(PLANTILLA),
      service: null,
    });
    expect(res).toEqual({ status: "no_configurado" });
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
      contarNoLeidosPorMensajero: vi.fn(async () => []),
      marcarLeidoHastaUltimoEntrante: vi.fn(async () => {}),
      migrarTelefono: vi.fn(async () => 0),
    };
  }

  function mensajes(lista: unknown[]): IChatMensajeRepository {
    return {
      insertarEntranteIdempotente: vi.fn(),
      insertarSaliente: vi.fn(),
      actualizarEstadoPorWaMessageId: vi.fn(),
      findByWaMessageId: vi.fn(),
      marcarFallido: vi.fn(async () => {}),
      reconciliarSaliente: vi.fn(),
      findById: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listarHilo: vi.fn(async () => lista as any),
      ultimoEntranteAt: vi.fn(async () => null),
      findMediaParaMensajero: vi.fn(async () => null),
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
    expect(res).toEqual({
      status: "ok",
      ventanaAbierta: false,
      ultimoEntranteAt: null,
      plantillaBloqueada: false,
      textoLibreHabilitado: false,
      mensajes: [],
    });
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

  // ---------------------------------------------------------------------------------------
  // EL CHAT SE DESBLOQUEA CADA DIA. Antes estas dos banderas se derivaban en el componente
  // sobre el hilo ENTERO y sin noción de fecha, así que un saliente de ayer —una plantilla,
  // o la bienvenida automática— dejaba el chat mudo PARA SIEMPRE: al mensajero que recibía
  // el paquete reasignado al día siguiente no le dejaba ni mandar plantilla ni escribir.
  //
  // El día es el CALENDARIO DE COSTA RICA, que empieza a las 06:00Z (UTC-6 fijo).
  // ---------------------------------------------------------------------------------------

  /** 12:00 CR del 23 de julio. El día CR arrancó a las 06:00Z de ese mismo 23. */
  const MEDIODIA_CR = new Date("2026-07-23T18:00:00.000Z");

  function hilo(
    lista: { direccion: "entrante" | "saliente"; ocurridoAt: Date }[],
    ultimoEntranteAt: Date | null,
    ahora: Date,
  ) {
    return listarHiloChat("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: conv({ id: "hilo-1", ultimoEntranteAt }),
      mensajeRepo: mensajes(
        lista.map((m, i) => ({
          id: `m${i}`,
          direccion: m.direccion,
          tipo: m.direccion === "saliente" ? "plantilla" : "texto",
          cuerpo: "x",
          estado: m.direccion === "saliente" ? "sent" : null,
          ocurridoAt: m.ocurridoAt,
        })),
      ),
      now: () => ahora,
    });
  }

  it("EL BUG: una plantilla enviada AYER no bloquea el chat de hoy", async () => {
    const res = await hilo(
      [{ direccion: "saliente", ocurridoAt: new Date("2026-07-22T20:00:00.000Z") }],
      null,
      MEDIODIA_CR,
    );
    // El paquete se reasigna al día siguiente: el mensajero puede volver a abrir la
    // conversación con una plantilla, como si fuera una gestión nueva.
    expect(res).toMatchObject({ plantillaBloqueada: false, textoLibreHabilitado: false });
  });

  it("un saliente de HOY sin respuesta sí bloquea la plantilla", async () => {
    const res = await hilo(
      [{ direccion: "saliente", ocurridoAt: new Date("2026-07-23T14:00:00.000Z") }],
      null,
      MEDIODIA_CR,
    );
    expect(res).toMatchObject({ plantillaBloqueada: true, textoLibreHabilitado: false });
  });

  it("si el cliente responde HOY se desbloquea y se habilita el texto libre", async () => {
    const entranteHoy = new Date("2026-07-23T15:00:00.000Z");
    const res = await hilo(
      [
        { direccion: "saliente", ocurridoAt: new Date("2026-07-23T14:00:00.000Z") },
        { direccion: "entrante", ocurridoAt: entranteHoy },
      ],
      entranteHoy,
      MEDIODIA_CR,
    );
    expect(res).toMatchObject({ plantillaBloqueada: false, textoLibreHabilitado: true });
  });

  it("un entrante de AYER deja la ventana de Meta abierta pero NO el texto libre", async () => {
    // 17:00 CR de ayer: 19 h antes de `now`, así que la ventana de 24 h sigue abierta. Aun
    // así el día empieza por una plantilla; el texto libre se gana con la respuesta de HOY.
    const entranteAyer = new Date("2026-07-22T23:00:00.000Z");
    const res = await hilo(
      [{ direccion: "entrante", ocurridoAt: entranteAyer }],
      entranteAyer,
      MEDIODIA_CR,
    );
    expect(res).toMatchObject({
      ventanaAbierta: true,
      plantillaBloqueada: false,
      textoLibreHabilitado: false,
    });
  });

  // La frontera del día, con el MISMO saliente y dos relojes separados por un segundo. Fija
  // que la cota es `inicioDelDiaCREnUtc` (06:00Z) y no la medianoche UTC de `startOfDayCR`:
  // con esta última, el caso de las 23:59 CR se leería como "ayer" y el chat se desbloquearía
  // seis horas antes de tiempo.
  const SALIENTE_22 = [
    { direccion: "saliente" as const, ocurridoAt: new Date("2026-07-22T20:00:00.000Z") },
  ];

  it("frontera: a las 23:59 CR del 22 el saliente sigue siendo de HOY", async () => {
    const res = await hilo(SALIENTE_22, null, new Date("2026-07-23T05:59:59.999Z"));
    expect(res).toMatchObject({ plantillaBloqueada: true });
  });

  it("frontera: a las 00:00 CR del 23 ese mismo saliente ya es de AYER", async () => {
    const res = await hilo(SALIENTE_22, null, new Date("2026-07-23T06:00:00.000Z"));
    expect(res).toMatchObject({ plantillaBloqueada: false });
  });
});

// Indicador de mensajes sin leer del chat del mensajero. El scope es la SESION en las dos
// acciones: el resumen no recibe `mensajeroId` (nadie pide el de otro) y el sellado pasa por
// el `OrdenEnvioReader`, igual que `listarHiloChat` (R16).

/** Repo del hilo con solo lo que estas dos acciones usan; el resto explota si se toca. */
function convNoLeidos(
  over: Partial<IChatConversacionRepository> = {},
): IChatConversacionRepository {
  return {
    resolverOrdenActivaPorNumero: vi.fn(),
    upsertParaOrden: vi.fn(),
    marcarUltimoEntrante: vi.fn(),
    findByOrdenParaMensajero: vi.fn(),
    findById: vi.fn(),
    contarNoLeidosPorMensajero: vi.fn(async () => []),
    marcarLeidoHastaUltimoEntrante: vi.fn(async () => {}),
    migrarTelefono: vi.fn(async () => 0),
    ...over,
  };
}

describe("resumenNoLeidosChat", () => {
  it("sin sesion -> unauthenticated (no consulta nada)", async () => {
    const repo = convNoLeidos();
    const res = await resumenNoLeidosChat({
      getActor: getActor(null),
      conversacionRepo: repo,
    });
    expect(res).toEqual({ status: "unauthenticated" });
    expect(repo.contarNoLeidosPorMensajero).not.toHaveBeenCalled();
  });

  it("consulta SOLO por el mensajero de la sesion", async () => {
    const repo = convNoLeidos({
      contarNoLeidosPorMensajero: vi.fn(async () => [
        { ordenId: "orden-1", noLeidos: 2 },
        { ordenId: "orden-2", noLeidos: 1 },
      ]),
    });

    const res = await resumenNoLeidosChat({
      getActor: getActor(MENSAJERO),
      conversacionRepo: repo,
    });

    expect(repo.contarNoLeidosPorMensajero).toHaveBeenCalledWith(MENSAJERO.usuarioId);
    expect(res).toEqual({
      status: "ok",
      conversaciones: [
        { ordenId: "orden-1", noLeidos: 2 },
        { ordenId: "orden-2", noLeidos: 1 },
      ],
    });
  });

  it("sin pendientes -> ok con lista vacia (la UI lo lee como cero)", async () => {
    const res = await resumenNoLeidosChat({
      getActor: getActor(MENSAJERO),
      conversacionRepo: convNoLeidos(),
    });
    expect(res).toEqual({ status: "ok", conversaciones: [] });
  });
});

describe("marcarChatLeido", () => {
  it("sin sesion -> unauthenticated", async () => {
    const repo = convNoLeidos();
    const res = await marcarChatLeido("orden-1", {
      getActor: getActor(null),
      conversacionRepo: repo,
    });
    expect(res).toEqual({ status: "unauthenticated" });
    expect(repo.marcarLeidoHastaUltimoEntrante).not.toHaveBeenCalled();
  });

  it("orden de otro mensajero -> forbidden y NO sella nada", async () => {
    const repo = convNoLeidos();
    const res = await marcarChatLeido("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(null), // no asignada a este mensajero
      conversacionRepo: repo,
    });
    expect(res).toEqual({ status: "forbidden" });
    expect(repo.marcarLeidoHastaUltimoEntrante).not.toHaveBeenCalled();
  });

  it("ordenId no valido -> forbidden sin llegar al repo", async () => {
    const repo = convNoLeidos();
    const res = await marcarChatLeido("", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: repo,
    });
    expect(res).toEqual({ status: "forbidden" });
    expect(repo.marcarLeidoHastaUltimoEntrante).not.toHaveBeenCalled();
  });

  it("orden del mensajero -> sella el hilo con el scope del actor", async () => {
    const repo = convNoLeidos();
    const res = await marcarChatLeido("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: repo,
    });
    expect(res).toEqual({ status: "ok" });
    expect(repo.marcarLeidoHastaUltimoEntrante).toHaveBeenCalledWith(
      "orden-1",
      MENSAJERO.usuarioId,
    );
  });

  it("es idempotente: sellar dos veces no cambia el desenlace", async () => {
    const repo = convNoLeidos();
    const deps = {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: repo,
    };
    expect(await marcarChatLeido("orden-1", deps)).toEqual({ status: "ok" });
    expect(await marcarChatLeido("orden-1", deps)).toEqual({ status: "ok" });
    expect(repo.marcarLeidoHastaUltimoEntrante).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Feature 311 — E2.T (R19/R20/R21/R35). El contrato que `listarHiloChat` entrega a la UI.
// ---------------------------------------------------------------------------

describe("Feature 311 · listarHiloChat expone los tipos nuevos (R19/R21)", () => {
  const AHORA_311 = new Date("2026-08-27T12:00:00.000Z");
  const RECIENTE = new Date(AHORA_311.getTime() - 60 * 60 * 1000);
  const MEDIA_ID_DE_META = "MEDIA-ID-DE-META-QUE-NO-DEBE-SALIR";

  /** Repo del hilo con lo minimo que usa `listarHiloChat` (copia local del de arriba). */
  function conv311(ultimoEntranteAt: Date): IChatConversacionRepository {
    return {
      resolverOrdenActivaPorNumero: vi.fn(),
      upsertParaOrden: vi.fn(),
      marcarUltimoEntrante: vi.fn(),
      findByOrdenParaMensajero: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "50688887777",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        ultimoEntranteAt,
      })),
      findById: vi.fn(),
      contarNoLeidosPorMensajero: vi.fn(async () => []),
      marcarLeidoHastaUltimoEntrante: vi.fn(async () => {}),
      migrarTelefono: vi.fn(async () => 0),
    };
  }

  function mensajes311(lista: unknown[]): IChatMensajeRepository {
    return {
      insertarEntranteIdempotente: vi.fn(),
      insertarSaliente: vi.fn(),
      actualizarEstadoPorWaMessageId: vi.fn(),
      findByWaMessageId: vi.fn(),
      marcarFallido: vi.fn(async () => {}),
      reconciliarSaliente: vi.fn(),
      findById: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listarHilo: vi.fn(async () => lista as any),
      ultimoEntranteAt: vi.fn(async () => null),
      findMediaParaMensajero: vi.fn(async () => null),
    };
  }

  /** Fila del repo con todos los campos del DTO; se sobreescribe lo que cada test necesita. */
  function fila(over: Record<string, unknown>) {
    return {
      id: "m1",
      conversacionId: "hilo-1",
      direccion: "entrante",
      tipo: "texto",
      cuerpo: null,
      plantillaId: null,
      waMessageId: null,
      estado: null,
      latitud: null,
      longitud: null,
      errorCodigo: null,
      errorTitulo: null,
      errorDetalle: null,
      mediaId: null,
      mediaMime: null,
      mediaNombre: null,
      mediaTamanoBytes: null,
      reaccionAWaMessageId: null,
      reaccionEmoji: null,
      contactos: null,
      sistemaTelefonoAnterior: null,
      sistemaTelefonoNuevo: null,
      ocurridoAt: RECIENTE,
      createdAt: RECIENTE,
      ...over,
    };
  }

  function listar(filas: unknown[]) {
    return listarHiloChat("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      conversacionRepo: conv311(RECIENTE),
      mensajeRepo: mensajes311(filas),
      now: () => AHORA_311,
    });
  }

  it("R19: un hilo con imagen + reaccion devuelve UNA burbuja con `reacciones` no vacio", async () => {
    const res = await listar([
      fila({
        id: "m-img",
        waMessageId: "wamid.IMG",
        tipo: "imagen",
        cuerpo: "mira",
        mediaId: MEDIA_ID_DE_META,
        mediaMime: "image/jpeg",
      }),
      fila({
        id: "m-react",
        waMessageId: "wamid.R",
        tipo: "reaccion",
        reaccionAWaMessageId: "wamid.IMG",
        reaccionEmoji: "❤️",
        ocurridoAt: new Date(RECIENTE.getTime() + 1000),
      }),
    ]);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    // La reaccion NO es una burbuja: el hilo tiene UNA sola (D4/R19).
    expect(res.mensajes).toHaveLength(1);
    expect(res.mensajes[0].id).toBe("m-img");
    expect(res.mensajes[0].reacciones).toEqual([{ emoji: "❤️", conteo: 1 }]);
    expect(res.mensajes[0].media).toEqual({
      mime: "image/jpeg",
      nombre: null,
      tamanoBytes: null,
    });
  });

  it("R21/R35: la vista NO contiene el media id de Meta en NINGUN campo", async () => {
    const res = await listar([
      fila({
        id: "m-img",
        waMessageId: "wamid.IMG",
        tipo: "imagen",
        mediaId: MEDIA_ID_DE_META,
        mediaMime: "image/jpeg",
      }),
    ]);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    // El id de Meta se queda en el servidor: la UI pide el binario por el id INTERNO.
    expect(JSON.stringify(res)).not.toContain(MEDIA_ID_DE_META);
    expect(res.mensajes[0].media).not.toBeNull();
  });

  it("R19: un mensaje de contactos expone los contactos ya tipados", async () => {
    const contacto = {
      nombre: "Ana Perez",
      telefonos: [{ valor: "+506 8888-1111", tipo: "CELL" }],
      correos: [],
      direcciones: [],
      organizacion: null,
      urls: [],
    };
    const res = await listar([
      fila({ id: "m-c", waMessageId: "wamid.C", tipo: "contactos", contactos: [contacto] }),
    ]);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.mensajes[0].contactos).toEqual([contacto]);
  });

  it("R19: un mensaje de sistema expone AMBOS numeros del cambio", async () => {
    const res = await listar([
      fila({
        id: "m-sys",
        waMessageId: "wamid.SYS",
        tipo: "sistema",
        sistemaTelefonoAnterior: "50688887777",
        sistemaTelefonoNuevo: "50699996666",
      }),
    ]);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.mensajes[0].sistema).toEqual({
      telefonoAnterior: "50688887777",
      telefonoNuevo: "50699996666",
    });
  });

  it("R20: una reaccion RETIRADA deja el mensaje objetivo SIN reacciones", async () => {
    const res = await listar([
      fila({ id: "m-txt", waMessageId: "wamid.T", tipo: "texto", cuerpo: "hola" }),
      fila({
        id: "m-r1",
        waMessageId: "wamid.R1",
        tipo: "reaccion",
        reaccionAWaMessageId: "wamid.T",
        reaccionEmoji: "👍",
        ocurridoAt: new Date(RECIENTE.getTime() + 1000),
      }),
      fila({
        id: "m-r2",
        waMessageId: "wamid.R2",
        tipo: "reaccion",
        reaccionAWaMessageId: "wamid.T",
        reaccionEmoji: null, // retirada (R5)
        ocurridoAt: new Date(RECIENTE.getTime() + 2000),
      }),
    ]);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.mensajes).toHaveLength(1);
    expect(res.mensajes[0].reacciones).toEqual([]);
  });

  it("un mensaje de texto sin nada de la 311 sale con los campos nuevos vacios", async () => {
    const res = await listar([fila({ id: "m-txt", tipo: "texto", cuerpo: "hola" })]);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.mensajes[0]).toMatchObject({
      media: null,
      contactos: null,
      sistema: null,
      reacciones: [],
    });
  });

  it("R16 sigue en pie: una orden ajena responde `forbidden` sin leer nada", async () => {
    const mensajeRepo = mensajes311([]);
    const res = await listarHiloChat("orden-1", {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(null), // la orden no es de este mensajero
      mensajeRepo,
    });

    expect(res).toEqual({ status: "forbidden" });
    expect(mensajeRepo.listarHilo).not.toHaveBeenCalled();
  });
});


// ---------------------------------------------------------------------------
// Feature 316 — D2.T (R11/R12/R26/R27). `enviarMediaChat(formData)`: el borde HTTP del envio
// de un adjunto. La puerta es la MISMA que `enviarMensajeChat`; lo propio es que el binario
// llega por `FormData` y que el servidor mide el archivo QUE LLEGO, no lo que le declaren.
// ---------------------------------------------------------------------------

describe("enviarMediaChat (R11/R12/R26/R27)", () => {
  /** `File` de prueba con el tamano que se pida, sin materializar los megas en memoria. */
  function archivo(
    { nombre = "foto.jpg", mime = "image/jpeg", bytes = 1234 } = {},
  ): File {
    const file = new File([new Uint8Array([1, 2, 3])], nombre, { type: mime });
    // `size` es de solo lectura en `File`: se sobrescribe para simular un archivo grande sin
    // reservar 6 MB en cada corrida del test.
    Object.defineProperty(file, "size", { value: bytes });
    return file;
  }

  function formData(
    over: { ordenId?: string; caption?: string; archivo?: File | null; extra?: Record<string, string> } = {},
  ): FormData {
    const fd = new FormData();
    fd.set("ordenId", over.ordenId ?? "orden-1");
    if (over.caption !== undefined) fd.set("caption", over.caption);
    const f = over.archivo === undefined ? archivo() : over.archivo;
    if (f !== null) fd.set("archivo", f);
    for (const [k, v] of Object.entries(over.extra ?? {})) fd.set(k, v);
    return fd;
  }

  function serviceFake(outcome: unknown = { status: "ok", mensajeId: "wamid.M", mensajeChatId: "msg-1" }) {
    return { enviarMedia: vi.fn(async () => outcome) } as unknown as ChatWhatsappService;
  }

  it("(a) R26: sin sesion -> unauthenticated, sin tocar la orden ni el service", async () => {
    const service = serviceFake();
    const reader = ordenReader(ORDEN_DATA);

    const res = await enviarMediaChat(formData(), {
      getActor: getActor(null),
      ordenReader: reader,
      service,
    });

    expect(res).toEqual({ status: "unauthenticated" });
    expect(reader.findParaEnvio).not.toHaveBeenCalled();
    expect(service.enviarMedia).not.toHaveBeenCalled();
  });

  it("(b) R27: orden de otro mensajero -> forbidden, sin llamar al service", async () => {
    const service = serviceFake();

    const res = await enviarMediaChat(formData(), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(null),
      service,
    });

    expect(res).toEqual({ status: "forbidden" });
    expect(service.enviarMedia).not.toHaveBeenCalled();
  });

  it("(c) R11: 6 MB se rechaza AUNQUE el FormData declare un `tamano` mentiroso", async () => {
    const service = serviceFake();

    const res = await enviarMediaChat(
      formData({
        archivo: archivo({ bytes: 6 * 1024 * 1024 }),
        // El campo mentiroso: si el servidor lo mirase, esto pasaria como 10 bytes.
        extra: { tamano: "10" },
      }),
      { getActor: getActor(MENSAJERO), ordenReader: ordenReader(ORDEN_DATA), service },
    );

    expect(res).toEqual({ status: "demasiado_grande", limiteBytes: 5 * 1024 * 1024 });
    expect(service.enviarMedia).not.toHaveBeenCalled();
  });

  it("(c) R11: un tipo fuera de la lista blanca se rechaza sin llamar al service", async () => {
    const service = serviceFake();

    const res = await enviarMediaChat(
      formData({ archivo: archivo({ nombre: "app.exe", mime: "application/x-msdownload" }) }),
      { getActor: getActor(MENSAJERO), ordenReader: ordenReader(ORDEN_DATA), service },
    );

    expect(res).toEqual({ status: "tipo_no_permitido" });
    expect(service.enviarMedia).not.toHaveBeenCalled();
  });

  it("(d) R12: un pie de MAX_CAPTION + 1 -> caption_largo, sin llamar al service", async () => {
    const service = serviceFake();

    const res = await enviarMediaChat(formData({ caption: "x".repeat(MAX_CAPTION + 1) }), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service,
    });

    expect(res).toEqual({ status: "caption_largo", maximo: MAX_CAPTION });
    expect(service.enviarMedia).not.toHaveBeenCalled();
  });

  it("(d) R12: el borde exacto (MAX_CAPTION) SI pasa", async () => {
    const service = serviceFake();

    const res = await enviarMediaChat(formData({ caption: "x".repeat(MAX_CAPTION) }), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service,
    });

    expect(res).toEqual({ status: "ok", mensajeChatId: "msg-1" });
  });

  it("(e) camino feliz: ok, y el service recibe el caption y el mime del ARCHIVO", async () => {
    const service = serviceFake();

    const res = await enviarMediaChat(
      formData({ caption: "aqui esta tu paquete", archivo: archivo({ nombre: "entrega.jpg" }) }),
      { getActor: getActor(MENSAJERO), ordenReader: ordenReader(ORDEN_DATA), service },
    );

    expect(res).toEqual({ status: "ok", mensajeChatId: "msg-1" });
    const arg = (service.enviarMedia as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573001112233",
      caption: "aqui esta tu paquete",
      adjunto: { mime: "image/jpeg", nombre: "entrega.jpg", bytes: 1234 },
    });
    // R18: el binario pasa TAL CUAL (es el `File` recibido), sin copia intermedia ni buffer.
    expect(typeof arg.adjunto.cuerpo.arrayBuffer).toBe("function");
  });

  it("un FormData sin archivo -> forbidden (peticion malformada), sin llamar al service", async () => {
    const service = serviceFake();

    const res = await enviarMediaChat(formData({ archivo: null }), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service,
    });

    expect(res).toEqual({ status: "forbidden" });
    expect(service.enviarMedia).not.toHaveBeenCalled();
  });

  it("R3: `fuera_ventana` del service se propaga a la UI", async () => {
    const res = await enviarMediaChat(formData(), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service: serviceFake({ status: "fuera_ventana" }),
    });

    expect(res).toEqual({ status: "fuera_ventana" });
  });

  it("R19: `fallo_subida` llega SIN el detalle interno del cliente", async () => {
    const res = await enviarMediaChat(formData(), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service: serviceFake({ status: "fallo_subida", detalle: "subir media a whatsapp: HTTP 500" }),
    });

    expect(res).toEqual({ status: "fallo_subida" });
    expect(res).not.toHaveProperty("detalle");
  });

  it("R20: `permanente` lleva el mensajeChatId del saliente failed y su motivo", async () => {
    const res = await enviarMediaChat(formData(), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service: serviceFake({
        status: "permanente",
        detalle: "enviar mensaje de whatsapp: HTTP 400",
        mensajeChatId: "msg-fail",
      }),
    });

    expect(res).toEqual({
      status: "permanente",
      mensajeChatId: "msg-fail",
      detalle: "enviar mensaje de whatsapp: HTTP 400",
    });
  });

  it("service null (sin credencial) -> no_configurado", async () => {
    const res = await enviarMediaChat(formData(), {
      getActor: getActor(MENSAJERO),
      ordenReader: ordenReader(ORDEN_DATA),
      service: null,
    });

    expect(res).toEqual({ status: "no_configurado" });
  });
});
