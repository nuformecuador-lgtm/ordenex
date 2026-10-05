import { describe, expect, it, vi } from "vitest";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import type {
  IPlantillaMensajeRepository,
  PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

// Ficha 474 (T5.1, R8) — una plantilla de INFORME no puede ser la bienvenida: «no aplica», aunque
// este `activo` y enlazada con Meta.

function plantilla(o: Partial<PlantillaPublica>): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "n",
    cuerpo: "c",
    variables: [],
    variablesNombres: {},
    estado: "activo",
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: "tpl",
    templateIdioma: "es",
    informeClave: null,
    llevaDocumento: false,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  };
}

describe("474/R8 — bienvenida de una plantilla de informe", () => {
  it("de informe y activa -> no_aplica y no marca", async () => {
    const marcarWelcomeMessage = vi.fn();
    const repo = {
      findById: vi.fn(async () => plantilla({ informeClave: "prueba_envio" })),
      marcarWelcomeMessage,
    } as unknown as IPlantillaMensajeRepository;
    const out = await new PlantillaMensajeService(repo).marcarMensajeBienvenida("pl-1", { usuarioId: "m", rol: "maestro" });
    expect(out).toEqual({ status: "no_aplica" });
    expect(marcarWelcomeMessage).not.toHaveBeenCalled();
  });

  it("de orden y activa -> se marca (sin cambios)", async () => {
    const marcarWelcomeMessage = vi.fn(async () => plantilla({ welcomeMessage: true }));
    const repo = {
      findById: vi.fn(async () => plantilla({})),
      marcarWelcomeMessage,
    } as unknown as IPlantillaMensajeRepository;
    const out = await new PlantillaMensajeService(repo).marcarMensajeBienvenida("pl-1", { usuarioId: "m", rol: "maestro" });
    expect(out.status).toBe("ok");
  });
});
