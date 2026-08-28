import { describe, it, expect, vi } from "vitest";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type {
  IChatMensajeRepository,
  InsertarEntranteInput,
} from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { WebhookEventos } from "@/lib/types/whatsapp-webhook";
import type { WhatsappEnvioOutcome } from "@/lib/clients/whatsapp-cloud";
import { SIN_CAMPOS_311 } from "@/tests/fixtures/chat-mensaje";
import { readFileSync } from "fs";
import { join as joinPath } from "path";

// Feature 109 — D1.T. Logica pura del service SIN DB ni HTTP (repos y cliente fakeados).
// Cubre R6 (registra entrantes), R7 (aplica statuses), R8 (dedupe), R18/R19 (ventana 24 h,
// bloqueo D2), R20 (persiste saliente ok), R21 (transitorio reintentable) y R25 (resolucion
// D4 + no romper el lote si no resuelve).

const AHORA = new Date("2026-07-23T12:00:00.000Z");

function fakeConversacionRepo(
  over: Partial<IChatConversacionRepository> = {},
): IChatConversacionRepository {
  return {
    resolverOrdenActivaPorNumero: vi.fn(async () => ({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573001112233",
    })),
    upsertParaOrden: vi.fn(async () => ({
      id: "hilo-1",
      telefonoE164: "573001112233",
      ordenId: "orden-1",
      mensajeroId: "men-1",
      ultimoEntranteAt: AHORA, // dentro de ventana por defecto
    })),
    marcarUltimoEntrante: vi.fn(async () => {}),
    findByOrdenParaMensajero: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    contarNoLeidosPorMensajero: vi.fn(async () => []),
    marcarLeidoHastaUltimoEntrante: vi.fn(async () => {}),
    migrarTelefono: vi.fn(async () => 1),
    ...over,
  };
}

function fakeMensajeRepo(over: Partial<IChatMensajeRepository> = {}): IChatMensajeRepository {
  return {
    insertarEntranteIdempotente: vi.fn(async () => true),
    findByWaMessageId: vi.fn(async () => null),
    marcarFallido: vi.fn(async () => {}),
    insertarSaliente: vi.fn(async () => ({
      id: "msg-out",
      conversacionId: "hilo-1",
      direccion: "saliente" as const,
      tipo: "texto" as const,
      cuerpo: "hola",
      plantillaId: null,
      waMessageId: null,
      estado: "queued" as const,
      latitud: null,
      longitud: null,
        errorCodigo: null,
        errorTitulo: null,
        errorDetalle: null,
        ...SIN_CAMPOS_311,
      ocurridoAt: AHORA,
      createdAt: AHORA,
    })),
    actualizarEstadoPorWaMessageId: vi.fn(async () => 1),
    reconciliarSaliente: vi.fn(async () => {}),
    findById: vi.fn(async () => null),
    listarHilo: vi.fn(async () => []),
    // La ventana de 24 h se decide por el ULTIMO ENTRANTE real del hilo (contrato nuevo del
    // service): por defecto "ahora" -> dentro de ventana, consistente con el hilo por defecto.
    ultimoEntranteAt: vi.fn(async () => AHORA),
    findMediaParaMensajero: vi.fn(async () => null),
    ...over,
  };
}

function fakeClient(outcome: WhatsappEnvioOutcome) {
  return {
    enviarTexto: vi.fn(async () => outcome),
    enviarPlantilla: vi.fn(async () => outcome),
  };
}

function eventos(over: Partial<WebhookEventos> = {}): WebhookEventos {
  return { mensajes: [], statuses: [], ...over };
}

describe("ingerirEventos (R6/R7/R8/R25)", () => {
  it("R6: registra cada entrante en su hilo y sella la ventana", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: msg,
      now: () => AHORA,
    });

    const resumen = await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.IN1",
            telefonoE164: "573001112233",
            tipo: "texto",
            cuerpo: "hola",
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    expect(msg.insertarEntranteIdempotente).toHaveBeenCalledTimes(1);
    expect(conv.marcarUltimoEntrante).toHaveBeenCalledWith("hilo-1", AHORA);
    expect(resumen.mensajesRegistrados).toBe(1);
  });

  it("R8: un entrante ya registrado (dedupe) no re-sella la ventana", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo({ insertarEntranteIdempotente: vi.fn(async () => false) });
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(
      eventos({
        mensajes: [
          { waMessageId: "wamid.DUP", telefonoE164: "573", tipo: "texto", cuerpo: "x", ocurridoAt: AHORA },
        ],
      }),
    );

    expect(conv.marcarUltimoEntrante).not.toHaveBeenCalled();
    expect(resumen.mensajesRegistrados).toBe(0);
  });

  it("R7: actualiza el estado del saliente por wa_message_id", async () => {
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({
      conversacionRepo: fakeConversacionRepo(),
      mensajeRepo: msg,
    });

    const resumen = await service.ingerirEventos(
      eventos({
        statuses: [{ waMessageId: "wamid.OUT1", estado: "delivered", ocurridoAt: AHORA, error: null }],
      }),
    );

    // El 3.er argumento es `undefined` a proposito en los estados sanos: NO toca las
    // columnas de error (solo un `failed` las escribe, y solo `null` las limpia).
    expect(msg.actualizarEstadoPorWaMessageId).toHaveBeenCalledWith(
      "wamid.OUT1",
      "delivered",
      undefined,
    );
    expect(resumen.statusesAplicados).toBe(1);
  });

  it("R25/R9: si el numero no resuelve, cuenta sinResolver y NO rompe el lote", async () => {
    const conv = fakeConversacionRepo({
      resolverOrdenActivaPorNumero: vi.fn(async () => null),
    });
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(
      eventos({
        mensajes: [
          { waMessageId: "wamid.X", telefonoE164: "573000", tipo: "texto", cuerpo: "?", ocurridoAt: AHORA },
        ],
      }),
    );

    expect(msg.insertarEntranteIdempotente).not.toHaveBeenCalled();
    expect(resumen).toMatchObject({ mensajesRegistrados: 0, sinResolver: 1 });
  });
});

describe("enviarTexto (R18/R19/R20/R21)", () => {
  it("R18/R20: dentro de la ventana envia y persiste el saliente con wa_message_id", async () => {
    const conv = fakeConversacionRepo({
      upsertParaOrden: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573001112233",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        // ultimo entrante hace 1 h -> dentro de la ventana de 24 h
        ultimoEntranteAt: new Date(AHORA.getTime() - 60 * 60 * 1000),
      })),
    });
    const msg = fakeMensajeRepo({
      insertarSaliente: vi.fn(async () => ({
        id: "msg-ok",
        conversacionId: "hilo-1",
        direccion: "saliente" as const,
        tipo: "texto" as const,
        cuerpo: "hola",
        plantillaId: null,
        waMessageId: "wamid.OUT9",
        estado: "sent" as const,
        latitud: null,
        longitud: null,
        errorCodigo: null,
        errorTitulo: null,
        errorDetalle: null,
        ...SIN_CAMPOS_311,
        ocurridoAt: AHORA,
        createdAt: AHORA,
      })),
    });
    const client = fakeClient({ status: "ok", mensajeId: "wamid.OUT9" });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: msg,
      client,
      now: () => AHORA,
    });

    const res = await service.enviarTexto({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573001112233",
      texto: "hola",
    });

    expect(client.enviarTexto).toHaveBeenCalledWith("573001112233", "hola");
    const arg = (msg.insertarSaliente as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ estado: "sent", waMessageId: "wamid.OUT9" });
    expect(res).toEqual({ status: "ok", mensajeId: "wamid.OUT9", mensajeChatId: "msg-ok" });
  });

  it("R19/D2: fuera de la ventana BLOQUEA (no envia) y exige plantilla", async () => {
    const conv = fakeConversacionRepo({
      upsertParaOrden: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        // hace 25 h -> fuera de la ventana
        ultimoEntranteAt: new Date(AHORA.getTime() - 25 * 60 * 60 * 1000),
      })),
    });
    const client = fakeClient({ status: "ok", mensajeId: "no-deberia" });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      // La ventana la decide el ULTIMO ENTRANTE real del hilo (contrato nuevo): hace 25 h -> fuera.
      mensajeRepo: fakeMensajeRepo({
        ultimoEntranteAt: vi.fn(async () => new Date(AHORA.getTime() - 25 * 60 * 60 * 1000)),
      }),
      client,
      now: () => AHORA,
    });

    const res = await service.enviarTexto({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573",
      texto: "hola",
    });

    expect(res).toEqual({ status: "fuera_ventana" });
    expect(client.enviarTexto).not.toHaveBeenCalled(); // bloqueado en el server
  });

  it("R19: sin ningun entrante (ultimoEntranteAt null) tambien bloquea", async () => {
    const conv = fakeConversacionRepo({
      upsertParaOrden: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        ultimoEntranteAt: null,
      })),
    });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      // Sin ningun entrante en el hilo -> ultimoEntranteAt null -> fuera de ventana (bloquea).
      mensajeRepo: fakeMensajeRepo({ ultimoEntranteAt: vi.fn(async () => null) }),
      client: fakeClient({ status: "ok", mensajeId: "x" }),
      now: () => AHORA,
    });

    const res = await service.enviarTexto({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573",
      texto: "hola",
    });
    expect(res.status).toBe("fuera_ventana");
  });

  it("R21: transitorio persiste como queued, encola reintento y no filtra el numero", async () => {
    const conv = fakeConversacionRepo({
      upsertParaOrden: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573001112233",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        ultimoEntranteAt: new Date(AHORA.getTime() - 60 * 60 * 1000),
      })),
    });
    const msg = fakeMensajeRepo({
      insertarSaliente: vi.fn(async () => ({
        id: "msg-queued",
        conversacionId: "hilo-1",
        direccion: "saliente" as const,
        tipo: "texto" as const,
        cuerpo: "hola",
        plantillaId: null,
        waMessageId: null,
        estado: "queued" as const,
        latitud: null,
        longitud: null,
        errorCodigo: null,
        errorTitulo: null,
        errorDetalle: null,
        ...SIN_CAMPOS_311,
        ocurridoAt: AHORA,
        createdAt: AHORA,
      })),
    });
    const encolarReintento = vi.fn(async () => {});
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: msg,
      client: fakeClient({ status: "transitorio", detalle: "enviar mensaje de whatsapp: HTTP 503" }),
      encolarReintento,
      now: () => AHORA,
    });

    const res = await service.enviarTexto({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "573001112233",
      texto: "hola",
    });

    const arg = (msg.insertarSaliente as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ estado: "queued", waMessageId: null }); // no se pierde
    expect(encolarReintento).toHaveBeenCalledWith("msg-queued"); // D1: reintento encolado
    expect(res).toMatchObject({ status: "transitorio", mensajeChatId: "msg-queued" });
    // El detalle no filtra el numero destino.
    if (res.status === "transitorio") expect(res).not.toHaveProperty("telefonoE164");
  });
});

describe("enviarPlantilla (envio + persistencia tipo plantilla)", () => {
  const INPUT = {
    ordenId: "orden-1",
    mensajeroId: "men-1",
    telefonoE164: "573001112233",
    plantillaId: "plt-1",
    nombre: "recordatorio_entrega",
    idioma: "es",
    componentes: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    cuerpoRenderizado: "Hola Ana, tu pedido llega hoy",
  };

  it("ok: persiste el saliente tipo plantilla con plantilla_id, cuerpo y wa_message_id", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo({
      insertarSaliente: vi.fn(async () => ({
        id: "msg-plt",
        conversacionId: "hilo-1",
        direccion: "saliente" as const,
        tipo: "plantilla" as const,
        cuerpo: INPUT.cuerpoRenderizado,
        plantillaId: "plt-1",
        waMessageId: "wamid.PLT1",
        estado: "sent" as const,
        latitud: null,
        longitud: null,
        errorCodigo: null,
        errorTitulo: null,
        errorDetalle: null,
        ...SIN_CAMPOS_311,
        ocurridoAt: AHORA,
        createdAt: AHORA,
      })),
    });
    const client = fakeClient({ status: "ok", mensajeId: "wamid.PLT1" });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: msg,
      client,
      now: () => AHORA,
    });

    const res = await service.enviarPlantilla(INPUT);

    expect(client.enviarPlantilla).toHaveBeenCalledWith(
      "573001112233",
      "recordatorio_entrega",
      "es",
      INPUT.componentes,
    );
    const arg = (msg.insertarSaliente as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      tipo: "plantilla",
      plantillaId: "plt-1",
      cuerpo: INPUT.cuerpoRenderizado,
      estado: "sent",
      waMessageId: "wamid.PLT1",
    });
    expect(res).toEqual({ status: "ok", mensajeId: "wamid.PLT1", mensajeChatId: "msg-plt" });
  });

  it("se puede enviar FUERA de la ventana de 24 h (no aplica bloqueo)", async () => {
    const conv = fakeConversacionRepo({
      upsertParaOrden: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573001112233",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        // hace 30 h -> fuera de ventana; el texto libre bloquearia, la plantilla NO.
        ultimoEntranteAt: new Date(AHORA.getTime() - 30 * 60 * 60 * 1000),
      })),
    });
    const client = fakeClient({ status: "ok", mensajeId: "wamid.PLT2" });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: fakeMensajeRepo(),
      client,
      now: () => AHORA,
    });

    const res = await service.enviarPlantilla(INPUT);

    expect(client.enviarPlantilla).toHaveBeenCalledTimes(1); // no se bloqueo
    expect(res.status).toBe("ok");
  });

  it("se puede enviar tambien SIN ningun entrante (ultimoEntranteAt null)", async () => {
    const conv = fakeConversacionRepo({
      upsertParaOrden: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573001112233",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        ultimoEntranteAt: null,
      })),
    });
    const client = fakeClient({ status: "ok", mensajeId: "wamid.PLT3" });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: fakeMensajeRepo(),
      client,
      now: () => AHORA,
    });

    const res = await service.enviarPlantilla(INPUT);
    expect(res.status).toBe("ok");
  });

  it("transitorio: persiste queued (no se pierde), encola reintento y no filtra el numero", async () => {
    const msg = fakeMensajeRepo({
      insertarSaliente: vi.fn(async () => ({
        id: "msg-plt-q",
        conversacionId: "hilo-1",
        direccion: "saliente" as const,
        tipo: "plantilla" as const,
        cuerpo: INPUT.cuerpoRenderizado,
        plantillaId: "plt-1",
        waMessageId: null,
        estado: "queued" as const,
        latitud: null,
        longitud: null,
        errorCodigo: null,
        errorTitulo: null,
        errorDetalle: null,
        ...SIN_CAMPOS_311,
        ocurridoAt: AHORA,
        createdAt: AHORA,
      })),
    });
    const encolarReintento = vi.fn(async () => {});
    const service = new ChatWhatsappService({
      conversacionRepo: fakeConversacionRepo(),
      mensajeRepo: msg,
      client: fakeClient({ status: "transitorio", detalle: "enviar mensaje de whatsapp: HTTP 503" }),
      encolarReintento,
      now: () => AHORA,
    });

    const res = await service.enviarPlantilla(INPUT);

    const arg = (msg.insertarSaliente as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ tipo: "plantilla", plantillaId: "plt-1", estado: "queued", waMessageId: null });
    expect(encolarReintento).toHaveBeenCalledWith("msg-plt-q");
    expect(res).toMatchObject({ status: "transitorio", mensajeChatId: "msg-plt-q" });
    if (res.status === "transitorio") expect(res).not.toHaveProperty("telefonoE164");
  });
});

describe("reintentarEnvio (D1/F3)", () => {
  it("reconcilia el saliente queued tras un reintento ok", async () => {
    const msg = fakeMensajeRepo({
      findById: vi.fn(async () => ({
        id: "msg-queued",
        conversacionId: "hilo-1",
        direccion: "saliente" as const,
        tipo: "texto" as const,
        cuerpo: "hola",
        plantillaId: null,
        waMessageId: null,
        estado: "queued" as const,
        latitud: null,
        longitud: null,
        errorCodigo: null,
        errorTitulo: null,
        errorDetalle: null,
        ...SIN_CAMPOS_311,
        ocurridoAt: AHORA,
        createdAt: AHORA,
      })),
    });
    const conv = fakeConversacionRepo({
      findById: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573001112233",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        ultimoEntranteAt: AHORA,
      })),
    });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: msg,
      client: fakeClient({ status: "ok", mensajeId: "wamid.RETRY" }),
    });

    await service.reintentarEnvio("msg-queued");

    expect(msg.reconciliarSaliente).toHaveBeenCalledWith("msg-queued", "wamid.RETRY", "sent");
  });

  it("relanza si el reintento vuelve a fallar (para el backoff del job)", async () => {
    const msg = fakeMensajeRepo({
      findById: vi.fn(async () => ({
        id: "msg-queued",
        conversacionId: "hilo-1",
        direccion: "saliente" as const,
        tipo: "texto" as const,
        cuerpo: "hola",
        plantillaId: null,
        waMessageId: null,
        estado: "queued" as const,
        latitud: null,
        longitud: null,
        errorCodigo: null,
        errorTitulo: null,
        errorDetalle: null,
        ...SIN_CAMPOS_311,
        ocurridoAt: AHORA,
        createdAt: AHORA,
      })),
    });
    const conv = fakeConversacionRepo({
      findById: vi.fn(async () => ({
        id: "hilo-1",
        telefonoE164: "573",
        ordenId: "orden-1",
        mensajeroId: "men-1",
        ultimoEntranteAt: AHORA,
      })),
    });
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: msg,
      client: fakeClient({ status: "transitorio", detalle: "enviar mensaje de whatsapp: HTTP 503" }),
    });

    await expect(service.reintentarEnvio("msg-queued")).rejects.toThrow();
    expect(msg.reconciliarSaliente).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Feature 311 — D1/D2/D3.T (R1/R2/R4/R5/R7/R12/R16/R17/R18/R35). Ingesta de los tipos nuevos
// y cambio de numero del cliente.
// ---------------------------------------------------------------------------

/** Inputs con los que se llamo `insertarEntranteIdempotente` (el fake es un `vi.fn`). */
function entrantesInsertados(repo: IChatMensajeRepository): InsertarEntranteInput[] {
  const fn = repo.insertarEntranteIdempotente as unknown as {
    mock: { calls: [InsertarEntranteInput][] };
  };
  return fn.mock.calls.map((c) => c[0]);
}

const CONTACTO_311 = {
  nombre: "Ana Perez",
  telefonos: [{ valor: "+506 8888-1111", tipo: "CELL" }],
  correos: [{ valor: "ana@example.com", tipo: null }],
  direcciones: [],
  organizacion: null,
  urls: [],
};

describe("Feature 311 · ingesta de los tipos nuevos (R1/R2/R4/R5/R7/R12)", () => {
  it("R1/R2: un entrante de imagen llega al repo con su mediaId y el caption como cuerpo", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.IMG",
            telefonoE164: "50688887777",
            tipo: "imagen",
            cuerpo: "mira la casa",
            media: {
              mediaId: "MEDIA-1",
              mediaMime: "image/jpeg",
              mediaNombre: null,
              mediaTamanoBytes: null,
            },
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    expect(msg.insertarEntranteIdempotente).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: "imagen",
        cuerpo: "mira la casa",
        mediaId: "MEDIA-1",
        mediaMime: "image/jpeg",
      }),
    );
  });

  it("R4: una reaccion llega con su objetivo y su emoji", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.R",
            telefonoE164: "50688887777",
            tipo: "reaccion",
            cuerpo: null,
            reaccion: { objetivoWaMessageId: "wamid.OBJ", emoji: "❤️" },
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    expect(msg.insertarEntranteIdempotente).toHaveBeenCalledWith(
      expect.objectContaining({
        reaccionAWaMessageId: "wamid.OBJ",
        reaccionEmoji: "❤️",
      }),
    );
  });

  it("R5: una reaccion RETIRADA llega con emoji null (no con cadena vacia)", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.R2",
            telefonoE164: "50688887777",
            tipo: "reaccion",
            cuerpo: null,
            reaccion: { objetivoWaMessageId: "wamid.OBJ", emoji: null },
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    const input = entrantesInsertados(msg)[0];
    expect(input.reaccionAWaMessageId).toBe("wamid.OBJ");
    expect(input.reaccionEmoji).toBeNull();
  });

  it("R7: los contactos llegan TIPADOS al repo, no como Json suelto", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.C",
            telefonoE164: "50688887777",
            tipo: "contactos",
            cuerpo: null,
            contactos: [CONTACTO_311],
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    expect(entrantesInsertados(msg)[0].contactos).toEqual([CONTACTO_311]);
  });

  it("R12: un entrante de media ya registrado no se duplica ni re-sella la ventana", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo({ insertarEntranteIdempotente: vi.fn(async () => false) });
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.YA",
            telefonoE164: "50688887777",
            tipo: "imagen",
            cuerpo: null,
            media: {
              mediaId: "MEDIA-1",
              mediaMime: null,
              mediaNombre: null,
              mediaTamanoBytes: null,
            },
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    expect(conv.marcarUltimoEntrante).not.toHaveBeenCalled();
    expect(resumen.mensajesRegistrados).toBe(0);
  });

  it("R12: solo el insert NUEVO sella `ultimo_entrante_at`", async () => {
    const conv = fakeConversacionRepo();
    let n = 0;
    const msg = fakeMensajeRepo({
      insertarEntranteIdempotente: vi.fn(async () => {
        n += 1;
        return n === 1; // el primero entra, el segundo lo omite el dedupe
      }),
    });
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(
      eventos({
        mensajes: [
          { waMessageId: "wamid.A", telefonoE164: "50688887777", tipo: "sticker", cuerpo: null, ocurridoAt: AHORA },
          { waMessageId: "wamid.A", telefonoE164: "50688887777", tipo: "sticker", cuerpo: null, ocurridoAt: AHORA },
        ],
      }),
    );

    expect(conv.marcarUltimoEntrante).toHaveBeenCalledTimes(1);
    expect(resumen.mensajesRegistrados).toBe(1);
  });
});

describe("Feature 311 · cambio de numero del cliente (R16/R17/R18)", () => {
  /** Un entrante `sistema` con los dos numeros, ya normalizado por el borde del webhook. */
  function eventoCambioNumero(waMessageId = "wamid.SYS") {
    return eventos({
      mensajes: [
        {
          waMessageId,
          telefonoE164: "50688887777", // el `from` es el numero ANTERIOR
          tipo: "sistema" as const,
          cuerpo: null,
          sistema: { telefonoAnterior: "50688887777", telefonoNuevo: "50699996666" },
          ocurridoAt: AHORA,
        },
      ],
    });
  }

  it("R16: llama migrarTelefono(anterior, nuevo) y lo cuenta en el resumen", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(eventoCambioNumero());

    expect(conv.migrarTelefono).toHaveBeenCalledWith("50688887777", "50699996666");
    expect(resumen.hilosMigrados).toBe(1);
  });

  it("R16: la migracion ocurre ANTES de resolver el hilo, y el hilo se keyea con el NUEVO", async () => {
    const orden: string[] = [];
    const conv = fakeConversacionRepo({
      migrarTelefono: vi.fn(async () => {
        orden.push("migrar");
        return 1;
      }),
      upsertParaOrden: vi.fn(async () => {
        orden.push("upsert");
        return {
          id: "hilo-1",
          telefonoE164: "50699996666",
          ordenId: "orden-1",
          mensajeroId: "men-1",
          ultimoEntranteAt: AHORA,
        };
      }),
    });
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    await service.ingerirEventos(eventoCambioNumero());

    expect(orden).toEqual(["migrar", "upsert"]);
    // El upsert usa el numero NUEVO: si usara el viejo, crearia un hilo vacio en paralelo y la
    // evidencia caeria fuera del hilo que el mensajero mira.
    expect(conv.upsertParaOrden).toHaveBeenCalledWith(
      expect.objectContaining({ telefonoE164: "50699996666" }),
    );
  });

  it("R18: deja evidencia PERSISTENTE con AMBOS numeros", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    await service.ingerirEventos(eventoCambioNumero());

    expect(msg.insertarEntranteIdempotente).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: "sistema",
        sistemaTelefonoAnterior: "50688887777",
        sistemaTelefonoNuevo: "50699996666",
      }),
    );
  });

  it("R18: reprocesar el MISMO wa_message_id no inserta una segunda evidencia", async () => {
    const conv = fakeConversacionRepo();
    // Meta reenvia el evento: el dedupe del insert lo omite.
    const msg = fakeMensajeRepo({ insertarEntranteIdempotente: vi.fn(async () => false) });
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(eventoCambioNumero());

    expect(msg.insertarEntranteIdempotente).toHaveBeenCalledTimes(1);
    expect(resumen.mensajesRegistrados).toBe(0);
    expect(conv.marcarUltimoEntrante).not.toHaveBeenCalled();
  });

  it("R18/P5: si el hilo destino ya existe (0 migradas) la ingesta NO se rompe", async () => {
    const conv = fakeConversacionRepo({ migrarTelefono: vi.fn(async () => 0) });
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(eventoCambioNumero());

    expect(resumen.hilosMigrados).toBe(0);
    // La evidencia se registra igual y el lote sigue: el webhook devuelve 200.
    expect(msg.insertarEntranteIdempotente).toHaveBeenCalledTimes(1);
    expect(resumen.mensajesRegistrados).toBe(1);
  });

  it("R17: al migrar el hilo NO se escribe fuera de chat_conversacion/chat_mensaje", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    await service.ingerirEventos(eventoCambioNumero());

    // POR CONSTRUCCION: al service solo se le inyectan los dos repos de CHAT, asi que no hay
    // ninguna via por la que pueda tocar `orden` o `cliente`. Lo que este test fija es la otra
    // mitad: de esos dos repos, la ingesta solo invoca los metodos de ESTE flujo. Un metodo
    // nuevo que escribiera el maestro (o una llamada inesperada) lo pone rojo.
    const invocados = (repo: Record<string, unknown>) =>
      Object.entries(repo)
        .filter(([, v]) => typeof v === "function" && (v as { mock?: { calls: unknown[] } }).mock)
        .filter(([, v]) => (v as { mock: { calls: unknown[] } }).mock.calls.length > 0)
        .map(([k]) => k)
        .sort();

    expect(invocados(conv as unknown as Record<string, unknown>)).toEqual([
      "marcarUltimoEntrante",
      "migrarTelefono",
      "resolverOrdenActivaPorNumero",
      "upsertParaOrden",
    ]);
    expect(invocados(msg as unknown as Record<string, unknown>)).toEqual([
      "insertarEntranteIdempotente",
    ]);
  });

  it("R17: el modulo del service no importa ningun repositorio de orden ni de cliente", () => {
    const fuente = readFileSync(
      joinPath(__dirname, "..", "..", "..", "lib", "services", "ChatWhatsappService.ts"),
      "utf8",
    );
    // `IOrdenEnvioReader` SI esta (es LECTURA, para reenviar una plantilla), pero ningun
    // repositorio de escritura del maestro de datos.
    expect(fuente).not.toMatch(/OrdenRepository/);
    expect(fuente).not.toMatch(/ClienteRepository/);
    expect(fuente).not.toMatch(/telefonoDest\s*=/);
  });

  it("LIMITACION CONOCIDA (decision humana 2026-08-27): un entrante desde el numero NUEVO NO resuelve orden y se cuenta sinResolver", async () => {
    // ESTO ES LO ESPERADO, NO UN BUG. Ver el bloque «LIMITACION CONOCIDA» bajo R16 en
    // `specs/311-chat-media-reacciones-contactos/requirements.md`: el cambio de numero se queda
    // SOLO COMO EVIDENCIA. La resolucion de un entrante va por `orden.telefono_dest`
    // (`ChatConversacionRepository.resolverOrdenActivaPorNumero`) y R17 prohibe tocar ese campo
    // del maestro, asi que migrar el hilo (R16) NO hace que los mensajes del numero nuevo
    // lleguen. El humano descarto la tabla de alias y escribir `orden.telefono_dest`.
    //
    // Si este test se pone rojo, alguien ha cambiado el comportamiento: NO lo "arregles"
    // tocando el maestro; reabre R16/R17 con el humano primero.
    const ANTERIOR = "50688887777";
    const NUEVO = "50699996666";

    // El fake reproduce la semantica REAL del repo: solo resuelve el numero que sigue guardado
    // en `orden.telefono_dest`, que es el ANTERIOR (R17 lo deja intacto).
    const conv = fakeConversacionRepo({
      resolverOrdenActivaPorNumero: vi.fn(async (telefono: string) =>
        telefono === ANTERIOR
          ? { ordenId: "orden-1", mensajeroId: "men-1", telefonoE164: ANTERIOR }
          : null,
      ),
    });
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    // 1) Llega el evento de cambio de numero: el hilo SI se migra (R16) y queda la evidencia.
    const migracion = await service.ingerirEventos(eventoCambioNumero());
    expect(migracion.hilosMigrados).toBe(1);
    expect(conv.migrarTelefono).toHaveBeenCalledWith(ANTERIOR, NUEVO);

    // 2) El cliente escribe DESDE EL NUMERO NUEVO. Aqui es donde se rompe la continuidad.
    const posterior = await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.DESPUES",
            telefonoE164: NUEVO,
            tipo: "texto",
            cuerpo: "ya cambie de numero, sigo esperando el pedido",
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    expect(conv.resolverOrdenActivaPorNumero).toHaveBeenLastCalledWith(NUEVO);
    expect(posterior).toMatchObject({ mensajesRegistrados: 0, sinResolver: 1 });
    // El mensaje no cae en el hilo migrado: no se inserta nada por este entrante (la unica
    // llamada al insert es la evidencia del paso 1).
    expect(msg.insertarEntranteIdempotente).toHaveBeenCalledTimes(1);
    // Y el lote no revienta: el service devuelve resumen en vez de lanzar, que es lo que deja al
    // webhook responder 200 (fijado en
    // `tests/integration/api/webhook-whatsapp.route.test.ts` :: "R9: responde 200 aunque un
    // evento no mapee a hilo (sinResolver)").
  });

  it("un entrante NORMAL no dispara ninguna migracion de hilo", async () => {
    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({ conversacionRepo: conv, mensajeRepo: msg });

    const resumen = await service.ingerirEventos(
      eventos({
        mensajes: [
          { waMessageId: "wamid.T", telefonoE164: "50688887777", tipo: "texto", cuerpo: "hola", ocurridoAt: AHORA },
        ],
      }),
    );

    expect(conv.migrarTelefono).not.toHaveBeenCalled();
    expect(resumen.hilosMigrados).toBe(0);
  });
});

describe("Feature 311 · PII en los logs de la ingesta (R35)", () => {
  it("no loguea numero, cuerpo, caption ni datos de contacto en NINGUNA rama", async () => {
    const NUMERO = "50688887777";
    const CAPTION = "esta es la casa amarilla de la esquina";
    const CORREO = "ana@example.com";

    const warn = vi.fn();
    const consolaWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consolaLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consolaError = vi.spyOn(console, "error").mockImplementation(() => {});

    const conv = fakeConversacionRepo();
    const msg = fakeMensajeRepo();
    const service = new ChatWhatsappService({
      conversacionRepo: conv,
      mensajeRepo: msg,
      logger: { warn },
    });

    await service.ingerirEventos(
      eventos({
        mensajes: [
          {
            waMessageId: "wamid.IMG",
            telefonoE164: NUMERO,
            tipo: "imagen",
            cuerpo: CAPTION,
            media: {
              mediaId: "MEDIA-1",
              mediaMime: "image/jpeg",
              mediaNombre: null,
              mediaTamanoBytes: null,
            },
            ocurridoAt: AHORA,
          },
          {
            waMessageId: "wamid.C",
            telefonoE164: NUMERO,
            tipo: "contactos",
            cuerpo: null,
            contactos: [CONTACTO_311],
            ocurridoAt: AHORA,
          },
          {
            waMessageId: "wamid.SYS",
            telefonoE164: NUMERO,
            tipo: "sistema",
            cuerpo: null,
            sistema: { telefonoAnterior: NUMERO, telefonoNuevo: "50699996666" },
            ocurridoAt: AHORA,
          },
        ],
      }),
    );

    const salida = [
      ...warn.mock.calls,
      ...consolaWarn.mock.calls,
      ...consolaLog.mock.calls,
      ...consolaError.mock.calls,
    ]
      .flat()
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join(" | ");

    for (const secreto of [NUMERO, CAPTION, CORREO, "Ana Perez", "50699996666", "MEDIA-1"]) {
      expect(salida).not.toContain(secreto);
    }

    consolaWarn.mockRestore();
    consolaLog.mockRestore();
    consolaError.mockRestore();
  });
});
