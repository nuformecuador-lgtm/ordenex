// Diagnostico y reintento de un saliente que Meta reporta como `failed`.
//
// Cubre las tres piezas nuevas:
//   1. el borde tipado deja de descartar `errors[]` (antes zod hacia strip y el motivo se perdia);
//   2. el service PERSISTE el motivo siempre y LOGUEA sin filtrar PII;
//   3. el reintento se encola SOLO para codigos transitorios (lista blanca conservadora).
import { describe, expect, it, vi } from "vitest";

import { datosPlantillaFixture } from "@/tests/fixtures/plantilla-datos";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { ChatLogger } from "@/lib/services/ChatWhatsappService";
import { CODIGOS_TRANSITORIOS, esErrorTransitorio } from "@/lib/services/whatsapp/errores-meta";
import { cuerpoParaLog, volcarStatusesFallidos } from "@/lib/services/whatsapp/chat-logger";
import { parseWebhookEventos } from "@/lib/types/whatsapp-webhook";
import type { IChatConversacionRepository } from "@/lib/interfaces/repositories/IChatConversacionRepository";
import { SIN_CAMPOS_311 } from "@/tests/fixtures/chat-mensaje";
import type {
  ChatMensajeDTO,
  IChatMensajeRepository,
} from "@/lib/interfaces/repositories/IChatMensajeRepository";

const WAMID = "wamid.OUT-FALLIDO";

/** Payload de Meta para un status `failed`, con la forma real de `errors[]`. */
function payloadFailed(code: number, extra: Record<string, unknown> = {}) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: WAMID,
                  status: "failed",
                  timestamp: "1800000000",
                  recipient_id: "573112195060",
                  errors: [
                    {
                      code,
                      title: "Message undeliverable",
                      message: "Message failed to send",
                      error_data: { details: "detalle especifico de Meta" },
                    },
                  ],
                  ...extra,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function salienteDTO(over: Partial<ChatMensajeDTO> = {}): ChatMensajeDTO {
  return {
    id: "msg-1",
    conversacionId: "hilo-1",
    direccion: "saliente",
    tipo: "plantilla",
    cuerpo: "cuerpo renderizado",
    plantillaId: "plt-1",
    waMessageId: WAMID,
    estado: "failed",
    latitud: null,
    longitud: null,
    errorCodigo: null,
    errorTitulo: null,
    errorDetalle: null,
    ...SIN_CAMPOS_311,
    ocurridoAt: new Date("2026-07-28T22:00:00Z"),
    createdAt: new Date("2026-07-28T22:00:00Z"),
    ...over,
  };
}

function deps(over: Partial<IChatMensajeRepository> = {}) {
  const mensajeRepo = {
    insertarEntranteIdempotente: vi.fn(async () => true),
    insertarSaliente: vi.fn(),
    actualizarEstadoPorWaMessageId: vi.fn(async () => 1),
    findByWaMessageId: vi.fn(async () => salienteDTO()),
    reconciliarSaliente: vi.fn(),
    findById: vi.fn(),
    listarHilo: vi.fn(),
    ultimoEntranteAt: vi.fn(),
    findMediaParaMensajero: vi.fn(async () => null),
    ...over,
  } as unknown as IChatMensajeRepository;
  const conversacionRepo = {} as IChatConversacionRepository;
  const encolarReintento = vi.fn(async () => {});
  const lineas: string[] = [];
  const logger: ChatLogger = { warn: (m) => lineas.push(m) };
  const service = new ChatWhatsappService({
    conversacionRepo,
    mensajeRepo,
    encolarReintento,
    logger,
  });
  return { service, mensajeRepo, encolarReintento, lineas };
}

describe("errores-meta: clasificacion", () => {
  it("solo los codigos de la lista blanca son transitorios", () => {
    for (const codigo of CODIGOS_TRANSITORIOS) {
      expect(esErrorTransitorio(codigo)).toBe(true);
    }
    // 131026 (indeliverable) y 132001 (plantilla no existe) son DETERMINISTAS.
    expect(esErrorTransitorio(131026)).toBe(false);
    expect(esErrorTransitorio(132001)).toBe(false);
  });

  it("un codigo ausente NO se reintenta (regla conservadora)", () => {
    expect(esErrorTransitorio(null)).toBe(false);
    expect(esErrorTransitorio(undefined)).toBe(false);
  });
});

describe("parseWebhookEventos: el motivo del fallo sobrevive al strip de zod", () => {
  it("normaliza codigo, titulo y detalle", () => {
    const { statuses } = parseWebhookEventos(payloadFailed(131026));
    expect(statuses).toHaveLength(1);
    expect(statuses[0].error).toEqual({
      codigo: 131026,
      titulo: "Message undeliverable",
      detalle: "detalle especifico de Meta", // error_data.details gana sobre message
    });
  });

  it("un status sin `errors` deja el motivo en null y no rompe", () => {
    const payload = {
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: WAMID, status: "delivered", timestamp: "1800000000" }] } },
          ],
        },
      ],
    };
    const { statuses } = parseWebhookEventos(payload);
    expect(statuses[0].error).toBeNull();
  });
});

describe("ingerirEventos: fallo determinista", () => {
  it("persiste el motivo y NO encola reintento", async () => {
    const { service, mensajeRepo, encolarReintento } = deps();
    await service.ingerirEventos(parseWebhookEventos(payloadFailed(131026)));

    expect(mensajeRepo.actualizarEstadoPorWaMessageId).toHaveBeenCalledWith(WAMID, "failed", {
      codigo: 131026,
      titulo: "Message undeliverable",
      detalle: "detalle especifico de Meta",
    });
    expect(encolarReintento).not.toHaveBeenCalled();
  });

  it("loguea el codigo y el detalle SIN el numero destino", async () => {
    const { service, lineas } = deps();
    await service.ingerirEventos(parseWebhookEventos(payloadFailed(131026)));

    const linea = lineas.join("\n");
    expect(linea).toContain("codigo=131026");
    expect(linea).toContain("transitorio=false");
    expect(linea).toContain("detalle especifico de Meta");
    expect(linea).not.toContain("573112195060"); // R11: nunca PII en el log
  });
});

describe("ingerirEventos: fallo transitorio", () => {
  it("devuelve el mensaje a `queued` y encola el reintento", async () => {
    const { service, mensajeRepo, encolarReintento } = deps();
    await service.ingerirEventos(parseWebhookEventos(payloadFailed(130429)));

    // El job solo reintenta salientes `queued`: sin este segundo update seria un no-op.
    expect(mensajeRepo.actualizarEstadoPorWaMessageId).toHaveBeenCalledWith(
      WAMID,
      "queued",
      expect.objectContaining({ codigo: 130429 }),
    );
    expect(encolarReintento).toHaveBeenCalledWith("msg-1");
  });

  it("no encola si el saliente aun no estaba registrado (status adelantado)", async () => {
    const { service, encolarReintento } = deps({
      actualizarEstadoPorWaMessageId: vi.fn(async () => 0),
    });
    await service.ingerirEventos(parseWebhookEventos(payloadFailed(130429)));
    expect(encolarReintento).not.toHaveBeenCalled();
  });
});

describe("volcarStatusesFallidos", () => {
  it("vuelca el status crudo completo con el destinatario redactado", () => {
    const lineas: string[] = [];
    volcarStatusesFallidos(payloadFailed(131026), { warn: (m) => lineas.push(m) });

    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('"code":131026');
    expect(lineas[0]).toContain('"recipient_id":"[redactado]"');
    expect(lineas[0]).not.toContain("573112195060");
  });

  it("ignora los statuses que no son `failed`", () => {
    const lineas: string[] = [];
    const payload = {
      entry: [{ changes: [{ value: { statuses: [{ id: WAMID, status: "delivered" }] } }] }],
    };
    volcarStatusesFallidos(payload, { warn: (m) => lineas.push(m) });
    expect(lineas).toHaveLength(0);
  });

  it("un cuerpo con forma inesperada no lanza (nunca rompe el 200)", () => {
    expect(() => volcarStatusesFallidos(null, { warn: () => {} })).not.toThrow();
    expect(() => volcarStatusesFallidos({ entry: "no-array" }, { warn: () => {} })).not.toThrow();
  });
});

describe("reintentarEnvio: un saliente de plantilla se reenvia COMO plantilla", () => {
  const hilo = {
    id: "hilo-1",
    telefonoE164: "573112195060",
    ordenId: "orden-1",
    mensajeroId: "men-1",
    ultimoEntranteAt: null,
  };
  const plantilla = {
    id: "plt-1",
    nombre: "aviso_entrega",
    cuerpo: "Hola {{1}}",
    variables: ["destinatario"],
    templateId: "tpl-meta-1",
    templateIdioma: "es_MX",
  };
  const orden = datosPlantillaFixture({ orden: { direccion: null, montoCobrar: 25.9 } });

  function servicioConPlantilla(tipo: "plantilla" | "texto") {
    const enviarPlantilla = vi.fn(async () => ({ status: "ok" as const, mensajeId: "wamid.NEW" }));
    const enviarTexto = vi.fn(async () => ({ status: "ok" as const, mensajeId: "wamid.TXT" }));
    const reconciliarSaliente = vi.fn(async () => {});
    const service = new ChatWhatsappService({
      conversacionRepo: { findById: vi.fn(async () => hilo) } as unknown as IChatConversacionRepository,
      mensajeRepo: {
        findById: vi.fn(async () => salienteDTO({ tipo, estado: "queued" })),
        reconciliarSaliente,
      } as unknown as IChatMensajeRepository,
      client: { enviarTexto, enviarPlantilla },
      plantillaRepo: { findEnviableById: vi.fn(async () => plantilla) },
      ordenReader: { findParaEnvio: vi.fn(async () => orden) },
      idiomaPorDefecto: "es",
    });
    return { service, enviarPlantilla, enviarTexto, reconciliarSaliente };
  }

  it("usa enviarPlantilla (no enviarTexto) y respeta el idioma de la plantilla", async () => {
    const { service, enviarPlantilla, enviarTexto } = servicioConPlantilla("plantilla");
    await service.reintentarEnvio("msg-1");

    expect(enviarTexto).not.toHaveBeenCalled();
    expect(enviarPlantilla).toHaveBeenCalledWith(
      "573112195060",
      "aviso_entrega",
      "es_MX",
      expect.anything(),
    );
  });

  it("reconcilia el saliente con el nuevo wa_message_id", async () => {
    const { service, reconciliarSaliente } = servicioConPlantilla("plantilla");
    await service.reintentarEnvio("msg-1");
    expect(reconciliarSaliente).toHaveBeenCalledWith("msg-1", "wamid.NEW", "sent");
  });

  it("un saliente de TEXTO sigue reenviandose como texto (sin regresion)", async () => {
    const { service, enviarTexto, enviarPlantilla } = servicioConPlantilla("texto");
    await service.reintentarEnvio("msg-1");
    expect(enviarPlantilla).not.toHaveBeenCalled();
    expect(enviarTexto).toHaveBeenCalledWith("573112195060", "cuerpo renderizado");
  });

  it("sin las deps de plantilla LANZA en vez de degradar a texto libre", async () => {
    const enviarTexto = vi.fn();
    const service = new ChatWhatsappService({
      conversacionRepo: { findById: vi.fn(async () => hilo) } as unknown as IChatConversacionRepository,
      mensajeRepo: {
        findById: vi.fn(async () => salienteDTO({ tipo: "plantilla", estado: "queued" })),
        reconciliarSaliente: vi.fn(),
      } as unknown as IChatMensajeRepository,
      client: { enviarTexto, enviarPlantilla: vi.fn() },
    });

    await expect(service.reintentarEnvio("msg-1")).rejects.toThrow(/faltan plantillaRepo/);
    expect(enviarTexto).not.toHaveBeenCalled();
  });
});

describe("cuerpoParaLog: volcado de la peticion saliente", () => {
  const cuerpo = {
    messaging_product: "whatsapp",
    to: "573112195060",
    type: "template",
    template: {
      name: "aviso_entrega",
      language: { code: "es_MX" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "Juan Perez" }] },
      ],
    },
  };

  it("por defecto conserva la ESTRUCTURA y redacta destino y contenido", () => {
    const salida = cuerpoParaLog(cuerpo) as typeof cuerpo;
    // Lo que explica un 400 sobrevive intacto: plantilla, idioma y forma de components.
    expect(salida.template.name).toBe("aviso_entrega");
    expect(salida.template.language.code).toBe("es_MX");
    expect(salida.template.components[0].parameters).toHaveLength(1);
    // El destino y el valor del parametro, no.
    expect(salida.to).toBe("[redactado]");
    expect(JSON.stringify(salida)).not.toContain("573112195060");
    expect(JSON.stringify(salida)).not.toContain("Juan Perez");
  });

  it("con WHATSAPP_DEBUG_LOG=true devuelve el cuerpo TAL CUAL", () => {
    const previo = process.env.WHATSAPP_DEBUG_LOG;
    process.env.WHATSAPP_DEBUG_LOG = "true";
    try {
      expect(cuerpoParaLog(cuerpo)).toBe(cuerpo);
    } finally {
      process.env.WHATSAPP_DEBUG_LOG = previo;
    }
  });
});
