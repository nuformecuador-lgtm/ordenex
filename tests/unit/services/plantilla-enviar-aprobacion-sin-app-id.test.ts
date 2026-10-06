import { describe, expect, it, vi } from "vitest";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import type { PlantillaWhatsappPropagator } from "@/lib/services/whatsapp/plantilla-whatsapp-sync";
import type {
  IPlantillaMensajeRepository,
  PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IResolutorAppIdMeta, ResultadoAppId } from "@/lib/clients/whatsapp-app-id";

// Ficha 474 (T5.1, R9 enmendado) — enviar a aprobacion una plantilla CON DOCUMENTO sin poder
// identificar la app de Meta (o sin credencial): `documento_no_disponible` con el texto de design
// §3, SIN cambiar el estado y sin un solo secreto en el mensaje.

const MAESTRO = { usuarioId: "m1", rol: "maestro" as const };

function plantilla(o: Partial<PlantillaPublica> = {}): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "prueba",
    cuerpo: "{{fecha}}",
    variables: ["fecha"],
    variablesNombres: {},
    estado: "saved_not_aprobation",
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: null,
    templateIdioma: null,
    informeClave: "prueba_envio",
    llevaDocumento: true,
    createdBy: "m1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  };
}

function montar(actual: PlantillaPublica, resultado: ResultadoAppId | null) {
  const updateEstado = vi.fn(async () => actual);
  const repo = { findById: vi.fn(async () => actual), updateEstado } as unknown as IPlantillaMensajeRepository;
  const trasActualizar = vi.fn(async () => {});
  const propagador = { trasActualizar } as unknown as PlantillaWhatsappPropagator;
  const resolutorAppId: IResolutorAppIdMeta | undefined =
    resultado === null ? undefined : { resolver: vi.fn(async () => resultado) };
  const s = new PlantillaMensajeService(repo, propagador, { resolutorAppId });
  return { s, updateEstado, trasActualizar };
}

describe("474/R9 — documento_no_disponible", () => {
  it("resolutor no_resuelto (http 190) -> texto con el codigo, sin cambiar estado ni llamar a Meta", async () => {
    const { s, updateEstado, trasActualizar } = montar(plantilla(), { ok: false, motivo: "http", codigo: 190 });
    const out = await s.enviarAprobacion("pl-1", MAESTRO);
    expect(out).toEqual({
      status: "documento_no_disponible",
      codigo: 190,
      mensaje:
        "No se pudo identificar la app de Meta con el token de WhatsApp configurado (código 190). Las plantillas con documento no se pueden enviar a aprobación hasta resolverlo; el resto sigue funcionando.",
    });
    expect(updateEstado).not.toHaveBeenCalled();
    expect(trasActualizar).not.toHaveBeenCalled();
  });

  it("credencial ausente -> nombra la VARIABLE, nunca un valor", async () => {
    const { s, updateEstado } = montar(plantilla(), {
      ok: false,
      motivo: "sin_credencial",
      variableFaltante: "WHATSAPP_CLOUD_TOKEN",
    });
    const out = await s.enviarAprobacion("pl-1", MAESTRO);
    expect(out.status).toBe("documento_no_disponible");
    if (out.status !== "documento_no_disponible") throw new Error();
    expect(out.mensaje).toContain("Falta configurar WhatsApp (falta WHATSAPP_CLOUD_TOKEN)");
    expect(out.mensaje).not.toMatch(/EAA|Bearer/);
    expect(updateEstado).not.toHaveBeenCalled();
  });

  it("sin resolutor inyectado: tambien documento_no_disponible (nunca un envio sin cabecera)", async () => {
    const { s } = montar(plantilla(), null);
    expect((await s.enviarAprobacion("pl-1", MAESTRO)).status).toBe("documento_no_disponible");
  });

  it("app identificada -> sigue el flujo normal (pending)", async () => {
    const { s, updateEstado, trasActualizar } = montar(plantilla(), { ok: true, appId: "1", origen: "meta" });
    const out = await s.enviarAprobacion("pl-1", MAESTRO);
    expect(out.status).toBe("ok");
    expect(trasActualizar).toHaveBeenCalled();
    expect(updateEstado).toHaveBeenCalledWith("pl-1", "pending");
  });

  it("plantilla SIN documento no consulta el resolutor (todo lo demas sigue funcionando, R48)", async () => {
    const resolver = vi.fn();
    const repo = {
      findById: vi.fn(async () => plantilla({ llevaDocumento: false })),
      updateEstado: vi.fn(async () => plantilla()),
    } as unknown as IPlantillaMensajeRepository;
    const s = new PlantillaMensajeService(repo, { trasActualizar: vi.fn() } as unknown as PlantillaWhatsappPropagator, {
      resolutorAppId: { resolver },
    });
    expect((await s.enviarAprobacion("pl-1", MAESTRO)).status).toBe("ok");
    expect(resolver).not.toHaveBeenCalled();
  });
});
