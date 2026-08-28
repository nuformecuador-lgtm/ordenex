// GUARDAR YA NO ES ENVIAR (2026-08-26). Tres reglas nuevas del ciclo de vida de una plantilla:
//
//   1. `crear` guarda en local y NO toca Meta: la plantilla nace `saved_not_aprobation`.
//   2. `enviarAprobacion` es la unica via de salida hacia Meta, y deja la fila `pending`.
//   3. `actualizar` reenvia a revision... salvo que la plantilla sea un borrador que nunca
//      salio de casa, en cuyo caso sigue siendo un borrador.
//
// Lo que se vigila aqui es sobre todo lo NEGATIVO —que crear no propague— porque es la clase de
// regresion que ningun test de resultado detecta: la plantilla se guarda igual de bien mientras
// alguien, por detras, la manda a un tercero de forma irreversible.
import { describe, expect, it, vi } from "vitest";

import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import type { PlantillaWhatsappPropagator } from "@/lib/services/whatsapp/plantilla-whatsapp-sync";
import type {
  IPlantillaMensajeRepository,
  PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { Actor } from "@/lib/interfaces/services/IPlantillaMensajeService";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

function plantilla(overrides: Partial<PlantillaPublica> = {}): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "aviso_entrega",
    cuerpo: "Hola {{cliente}}",
    variables: ["cliente"],
    variablesNombres: {},
    estado: "saved_not_aprobation",
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: null,
    templateIdioma: null,
    createdBy: "m1",
    createdAt: new Date("2026-08-26"),
    updatedAt: new Date("2026-08-26"),
    ...overrides,
  };
}

function repoFalso(overrides: Partial<IPlantillaMensajeRepository> = {}) {
  const create = vi.fn(async (data: { nombre: string }) =>
    plantilla({ nombre: data.nombre }),
  );
  const findById = vi.fn(async () => plantilla());
  const update = vi.fn(async () => plantilla());
  const updateEstado = vi.fn(async (_id: string, estado: PlantillaPublica["estado"]) =>
    plantilla({ estado }),
  );
  const findByNombre = vi.fn(async () => null);
  return {
    create,
    findById,
    update,
    updateEstado,
    findByNombre,
    ...overrides,
  } as unknown as IPlantillaMensajeRepository & {
    create: typeof create;
    findById: typeof findById;
    update: typeof update;
    updateEstado: typeof updateEstado;
  };
}

function propagadorFalso() {
  return {
    trasCrear: vi.fn(async () => {}),
    trasActualizar: vi.fn(async () => {}),
    trasEliminar: vi.fn(async () => {}),
  } as unknown as PlantillaWhatsappPropagator & {
    trasCrear: ReturnType<typeof vi.fn>;
    trasActualizar: ReturnType<typeof vi.fn>;
  };
}

describe("crear ya no propaga a Meta", () => {
  it("guarda con estado `saved_not_aprobation`", async () => {
    const repo = repoFalso();
    const service = new PlantillaMensajeService(repo, propagadorFalso());

    const res = await service.crear({ nombre: "aviso", cuerpo: "Hola {{cliente}}", plantillaTienda: false }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "saved_not_aprobation" }),
    );
  });

  it("NO llama al propagador: crear no manda nada a un tercero", async () => {
    const repo = repoFalso();
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    await service.crear({ nombre: "aviso", cuerpo: "Hola", plantillaTienda: false }, MAESTRO);

    expect(whatsapp.trasCrear).not.toHaveBeenCalled();
    expect(whatsapp.trasActualizar).not.toHaveBeenCalled();
  });
});

describe("enviarAprobacion", () => {
  it("propaga a Meta y deja la plantilla `pending`", async () => {
    const repo = repoFalso();
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    const res = await service.enviarAprobacion("pl-1", MAESTRO);

    expect(whatsapp.trasActualizar).toHaveBeenCalledTimes(1);
    expect(repo.updateEstado).toHaveBeenCalledWith("pl-1", "pending");
    expect(res.status).toBe("ok");
  });

  it("ya en revision -> `ya_enviada`, sin una segunda peticion a Meta", async () => {
    const repo = repoFalso({
      findById: vi.fn(async () => plantilla({ estado: "pending", templateId: "tpl-1" })),
    } as Partial<IPlantillaMensajeRepository>);
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    const res = await service.enviarAprobacion("pl-1", MAESTRO);

    expect(res.status).toBe("ya_enviada");
    expect(whatsapp.trasActualizar).not.toHaveBeenCalled();
  });

  // Sin credenciales no hay a quien enviar. Dejarla `pending` seria decir que Meta la esta
  // revisando cuando no ha recibido nada, y el maestro esperaria un veredicto que no llega.
  it("sin WhatsApp configurado -> `no_configurado` y el estado NO se toca", async () => {
    const repo = repoFalso();
    const service = new PlantillaMensajeService(repo); // sin propagador

    const res = await service.enviarAprobacion("pl-1", MAESTRO);

    expect(res.status).toBe("no_configurado");
    expect(repo.updateEstado).not.toHaveBeenCalled();
  });

  it("solo `maestro`; otro rol no llega ni a leer la fila", async () => {
    const repo = repoFalso();
    const service = new PlantillaMensajeService(repo, propagadorFalso());

    const res = await service.enviarAprobacion("pl-1", { usuarioId: "u2", rol: "admin" });

    expect(res.status).toBe("forbidden");
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("plantilla inexistente -> not_found", async () => {
    const repo = repoFalso({
      findById: vi.fn(async () => null),
    } as Partial<IPlantillaMensajeRepository>);
    const service = new PlantillaMensajeService(repo, propagadorFalso());

    expect((await service.enviarAprobacion("pl-1", MAESTRO)).status).toBe("not_found");
  });
});

describe("actualizar", () => {
  it("una plantilla que Meta YA tiene vuelve a revision (`pending`)", async () => {
    const enMeta = plantilla({ estado: "activo", templateId: "tpl-1" });
    const repo = repoFalso({
      findById: vi.fn(async () => enMeta),
      update: vi.fn(async () => enMeta),
    } as Partial<IPlantillaMensajeRepository>);
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    const res = await service.actualizar("pl-1", { cuerpo: "Hola {{cliente}}!" }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(whatsapp.trasActualizar).toHaveBeenCalledTimes(1);
    expect(repo.updateEstado).toHaveBeenCalledWith("pl-1", "pending");
  });

  // Si editar un borrador lo mandara a Meta, `saved_not_aprobation` duraria una sola edicion.
  it("un BORRADOR nunca enviado se edita sin salir hacia Meta", async () => {
    const repo = repoFalso(); // findById -> saved_not_aprobation + templateId null
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    const res = await service.actualizar("pl-1", { cuerpo: "Otro texto" }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(whatsapp.trasActualizar).not.toHaveBeenCalled();
    expect(repo.updateEstado).not.toHaveBeenCalled();
  });
});
