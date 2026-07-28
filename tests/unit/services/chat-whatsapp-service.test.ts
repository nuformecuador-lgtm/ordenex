import { describe, it, expect, vi } from "vitest";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import type { IChatMensajeRepository } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { WebhookEventos } from "@/lib/types/whatsapp-webhook";
import type { WhatsappEnvioOutcome } from "@/lib/clients/whatsapp-cloud";

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
