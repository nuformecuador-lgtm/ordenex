import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  crearWhatsappBienvenidaHandler,
  type WhatsappBienvenidaDeps,
} from "@/lib/services/jobs/whatsapp-bienvenida-handler";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { PlantillaBienvenida } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { DatosPlantilla } from "@/lib/types/plantilla-datos";
import { datosPlantillaFixture } from "@/tests/fixtures/plantilla-datos";

// MENSAJE DE BIENVENIDA — handler del job. Aislado del route (mismo patron que
// `procesar-jobs-whatsapp-chat-envio.test.ts`): sin DB, sin Meta, sin credenciales.
//
// El eje de la suite es la POLITICA DE RASTRO acordada: el handler LANZA en las condiciones de
// configuracion —para que dejen una fila `jobs` en `failed` con el motivo concreto— y NO lanza
// por el desenlace de Meta, que ya deja mejor rastro en el propio hilo del chat.

const PLANTILLA_MARCADA: PlantillaBienvenida = {
  id: "plt-1",
  nombre: "bienvenida_ordenex",
  templateId: "meta-1",
  estado: "activo",
};

const ENVIABLE = {
  id: "plt-1",
  nombre: "bienvenida_ordenex",
  cuerpo: "Hola {{cliente}}, tu paquete va en camino.",
  variables: ["cliente"],
  templateId: "meta-1",
  templateIdioma: "es_CR",
};

const DATOS: DatosPlantilla = datosPlantillaFixture({
  orden: {
    numGuia: 10,
    numRemision: "R-1",
    destinatario: "Ana",
    telefonoDest: "50688887777",
    producto: "caja",
    direccion: "calle 1",
    montoCobrar: 100,
  },
});

const JOB: JobDTO = {
  id: "job-1",
  payload: { ordenId: "orden-1", mensajeroId: "men-1", ocurridoAt: "2026-08-27T15:00:00.000Z" },
} as unknown as JobDTO;

const enviarPlantilla = vi.fn();
const findWelcomeMessage = vi.fn();
const findEnviableById = vi.fn();
const findParaEnvio = vi.fn();
const warn = vi.fn();

function deps(): WhatsappBienvenidaDeps {
  return {
    service: { enviarPlantilla } as unknown as ChatWhatsappService,
    plantillaRepo: { findWelcomeMessage, findEnviableById },
    ordenReader: { findParaEnvio },
    idiomaPorDefecto: "es",
    logger: { warn },
  };
}

const handler = crearWhatsappBienvenidaHandler(deps);

beforeEach(() => {
  enviarPlantilla.mockReset().mockResolvedValue({ status: "ok", mensajeId: "wamid.X", mensajeChatId: "msg-1" });
  findWelcomeMessage.mockReset().mockResolvedValue(PLANTILLA_MARCADA);
  findEnviableById.mockReset().mockResolvedValue(ENVIABLE);
  findParaEnvio.mockReset().mockResolvedValue(DATOS);
  warn.mockReset();
});

describe("camino feliz", () => {
  it("envia la plantilla marcada con los componentes y el cuerpo ya resueltos", async () => {
    await handler(JOB);

    expect(enviarPlantilla).toHaveBeenCalledTimes(1);
    expect(enviarPlantilla).toHaveBeenCalledWith({
      ordenId: "orden-1",
      mensajeroId: "men-1",
      telefonoE164: "50688887777",
      plantillaId: "plt-1",
      nombre: "bienvenida_ordenex",
      idioma: "es_CR",
      componentes: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
      cuerpoRenderizado: "Hola Ana, tu paquete va en camino.",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("la orden se lee SCOPEADA por el mensajero que recogio", async () => {
    await handler(JOB);
    expect(findParaEnvio).toHaveBeenCalledWith("orden-1", "men-1");
  });

  it("cae al idioma por defecto si la plantilla no trae el suyo sincronizado", async () => {
    findEnviableById.mockResolvedValue({ ...ENVIABLE, templateIdioma: "" });
    await handler(JOB);
    expect(enviarPlantilla.mock.calls[0][0].idioma).toBe("es");
  });
});

describe("condiciones de configuracion: LANZAN, para dejar rastro con su motivo", () => {
  it("payload invalido -> rechaza sin tocar nada", async () => {
    await expect(handler({ ...JOB, payload: { ordenId: "orden-1" } } as JobDTO)).rejects.toThrow();
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });

  it("la bienvenida se desmarco entre la recogida y el drenado", async () => {
    findWelcomeMessage.mockResolvedValue(null);
    await expect(handler(JOB)).rejects.toThrow(/ninguna plantilla marcada/i);
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });

  it("la plantilla marcada no esta activa -> el motivo CITA el estado", async () => {
    findWelcomeMessage.mockResolvedValue({ ...PLANTILLA_MARCADA, estado: "pending" });
    await expect(handler(JOB)).rejects.toThrow(/pending/);
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });

  it("la plantilla marcada no tiene template_id -> el motivo lo dice", async () => {
    findWelcomeMessage.mockResolvedValue({ ...PLANTILLA_MARCADA, templateId: null });
    await expect(handler(JOB)).rejects.toThrow(/template_id/);
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });

  it("la orden ya no es del mensajero que la recogio", async () => {
    findParaEnvio.mockResolvedValue(null);
    await expect(handler(JOB)).rejects.toThrow(/ya no esta asignada/i);
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });

  it("sin telefono de destinatario -> lanza ANTES de enviar, para no crear un hilo basura", async () => {
    // `enviarPlantilla` hace `upsertParaOrden` antes de llamar a Meta: sin esta guarda quedaria
    // una `chat_conversacion` con `telefono_e164 = ""` que Meta iba a rechazar igual.
    findParaEnvio.mockResolvedValue(datosPlantillaFixture({ orden: { telefonoDest: "" } }));
    await expect(handler(JOB)).rejects.toThrow(/telefono/i);
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });
});

describe("desenlaces de Meta: NO lanzan (el rastro ya vive en el hilo del chat)", () => {
  it("`permanente` -> el job se completa; el saliente quedo `failed` con el error de Meta", async () => {
    enviarPlantilla.mockResolvedValue({
      status: "permanente",
      detalle: "template no aprobado",
      mensajeChatId: "msg-1",
    });
    await expect(handler(JOB)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("`transitorio` -> el job se completa; lo reintenta `whatsapp_chat_envio`", async () => {
    enviarPlantilla.mockResolvedValue({
      status: "transitorio",
      detalle: "429",
      mensajeChatId: "msg-1",
    });
    await expect(handler(JOB)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("el aviso no filtra el telefono ni el cuerpo del mensaje", async () => {
    enviarPlantilla.mockResolvedValue({ status: "permanente", detalle: "x", mensajeChatId: "m" });
    await handler(JOB);
    const linea = warn.mock.calls[0][0] as string;
    expect(linea).not.toContain("50688887777");
    expect(linea).not.toContain("Ana");
    expect(linea).toContain("orden-1");
  });
});
