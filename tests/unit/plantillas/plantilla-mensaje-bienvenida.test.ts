import { describe, it, expect, vi } from "vitest";

import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { marcarPlantillaBienvenida } from "@/lib/actions/plantillas";
import type {
  IPlantillaMensajeRepository,
  PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type {
  Actor,
  IPlantillaMensajeService,
} from "@/lib/interfaces/services/IPlantillaMensajeService";

// MENSAJE DE BIENVENIDA — la plantilla que sale automaticamente cuando el paquete es recogido.
// Lo que aqui se fija: que solo el maestro puede moverla, que "no existe" no se confunde con
// "hecho", y que quien decide el valor escrito es el servidor y no el llamador.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

function plantilla(overrides: Partial<PlantillaPublica> = {}): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "Bienvenida",
    cuerpo: "Hola {{destinatario}}",
    variables: ["destinatario"],
    variablesNombres: {},
    estado: "saved_not_aprobation",
    welcomeMessage: false,
    templateId: null,
    templateIdioma: null,
    createdBy: "m1",
    createdAt: new Date("2026-08-26"),
    updatedAt: new Date("2026-08-26"),
    ...overrides,
  };
}

function repoFalso(overrides: Partial<IPlantillaMensajeRepository> = {}) {
  return {
    marcarWelcomeMessage: vi.fn().mockResolvedValue(plantilla({ welcomeMessage: true })),
    ...overrides,
  } as unknown as IPlantillaMensajeRepository;
}

describe("service.marcarMensajeBienvenida", () => {
  it("marca la plantilla y devuelve la fila con welcomeMessage en true", async () => {
    const repo = repoFalso();
    const service = new PlantillaMensajeService(repo);

    const r = await service.marcarMensajeBienvenida("pl-1", MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.plantilla.welcomeMessage).toBe(true);
    expect(repo.marcarWelcomeMessage).toHaveBeenCalledWith("pl-1");
  });

  it("se permite desde CUALQUIER estado: un borrador sin aprobar tambien se puede elegir", async () => {
    // Elegir la bienvenida es una decision local; esperar a la aprobacion de Meta para poder
    // siquiera declararla dejaria el ajuste inaccesible justo cuando se configura el modulo.
    const repo = repoFalso({
      marcarWelcomeMessage: vi
        .fn()
        .mockResolvedValue(plantilla({ estado: "saved_not_aprobation", welcomeMessage: true })),
    });
    const service = new PlantillaMensajeService(repo);

    const r = await service.marcarMensajeBienvenida("pl-1", MAESTRO);

    expect(r.status).toBe("ok");
  });

  it("es idempotente: volver a marcar la misma plantilla no la desmarca", async () => {
    // El repositorio hace `set`, no `toggle` (ver `marcarWelcomeMessage`). Que el service no
    // introduzca un toggle por su cuenta es lo que evita que un doble click deje al negocio
    // SIN mensaje de bienvenida.
    const repo = repoFalso();
    const service = new PlantillaMensajeService(repo);

    const uno = await service.marcarMensajeBienvenida("pl-1", MAESTRO);
    const dos = await service.marcarMensajeBienvenida("pl-1", MAESTRO);

    expect(uno.status).toBe("ok");
    expect(dos.status).toBe("ok");
    if (dos.status === "ok") expect(dos.plantilla.welcomeMessage).toBe(true);
  });

  it("not_found cuando la plantilla no existe o esta borrada", async () => {
    const repo = repoFalso({ marcarWelcomeMessage: vi.fn().mockResolvedValue(null) });
    const service = new PlantillaMensajeService(repo);

    expect((await service.marcarMensajeBienvenida("nope", MAESTRO)).status).toBe("not_found");
  });

  it.each([["admin"], ["adminTienda"], ["adminSatelite"], ["mensajero"], ["apiKey"]])(
    "forbidden para %s, SIN tocar el repositorio",
    async (rol) => {
      const repo = repoFalso();
      const service = new PlantillaMensajeService(repo);

      const r = await service.marcarMensajeBienvenida("pl-1", {
        usuarioId: "u1",
        rol: rol as Actor["rol"],
      });

      expect(r.status).toBe("forbidden");
      expect(repo.marcarWelcomeMessage).not.toHaveBeenCalled();
    },
  );
});

function servicioFalso(overrides: Partial<IPlantillaMensajeService> = {}) {
  return {
    marcarMensajeBienvenida: vi
      .fn()
      .mockResolvedValue({ status: "ok", plantilla: plantilla({ welcomeMessage: true }) }),
    ...overrides,
  } as unknown as IPlantillaMensajeService;
}

describe("action.marcarPlantillaBienvenida", () => {
  it("sin sesion -> unauthenticated SIN tocar el service", async () => {
    const plantillaService = servicioFalso();

    const r = await marcarPlantillaBienvenida("pl-1", {
      plantillaService,
      getActor: async () => null,
    });

    expect(r.status).toBe("unauthenticated");
    expect(plantillaService.marcarMensajeBienvenida).not.toHaveBeenCalled();
  });

  it("id vacio -> validation_error sobre `id`", async () => {
    const plantillaService = servicioFalso();

    const r = await marcarPlantillaBienvenida("", {
      plantillaService,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    expect(plantillaService.marcarMensajeBienvenida).not.toHaveBeenCalled();
  });

  it("con sesion de maestro delega el id al service", async () => {
    const plantillaService = servicioFalso();

    const r = await marcarPlantillaBienvenida("pl-1", {
      plantillaService,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("ok");
    expect(plantillaService.marcarMensajeBienvenida).toHaveBeenCalledWith("pl-1", MAESTRO);
  });
});

describe("repositorio.marcarWelcomeMessage", () => {
  /**
   * Prisma falso que ANOTA las llamadas en el orden en que se construyen. El `$transaction`
   * solo resuelve el array: lo que se comprueba aqui es la FORMA de las dos escrituras y su
   * orden, que es donde vive el riesgo (el UNIQUE parcial de la base rechaza dos filas
   * vigentes en `true`, aunque sea a mitad de la transaccion).
   */
  function prismaEspia(countMarcada: number) {
    const llamadas: Array<{ where: unknown; data: unknown }> = [];
    const prisma = {
      plantillaMensaje: {
        updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
          llamadas.push(args);
          // La primera es el CLEAR, la segunda el SET.
          return { count: llamadas.length === 1 ? 1 : countMarcada };
        }),
        findFirst: vi.fn(async () => ({
          ...plantilla({ welcomeMessage: true }),
          variablesNombres: {},
        })),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return { prisma, llamadas };
  }

  it("desmarca ANTES de marcar, y ambas escrituras van en la MISMA transaccion", async () => {
    const { prisma, llamadas } = prismaEspia(1);
    const repo = new PlantillaMensajeRepository(
      prisma as unknown as ConstructorParameters<typeof PlantillaMensajeRepository>[0],
    );

    const r = await repo.marcarWelcomeMessage("pl-1");

    expect(r?.welcomeMessage).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(llamadas).toHaveLength(2);
    // 1) CLEAR: todas las que tuvieran la marca menos la que se va a marcar.
    expect(llamadas[0]).toEqual({
      where: { welcomeMessage: true, NOT: { id: "pl-1" } },
      data: { welcomeMessage: false },
    });
    // 2) SET: solo la fila pedida, y solo si esta VIGENTE (una borrada no se marca).
    expect(llamadas[1]).toEqual({
      where: { id: "pl-1", deletedAt: null },
      data: { welcomeMessage: true },
    });
  });

  it("null cuando el SET no alcanza ninguna fila vigente (no existe o esta borrada)", async () => {
    const { prisma } = prismaEspia(0);
    const repo = new PlantillaMensajeRepository(
      prisma as unknown as ConstructorParameters<typeof PlantillaMensajeRepository>[0],
    );

    expect(await repo.marcarWelcomeMessage("fantasma")).toBeNull();
    // No se relee la fila que no se pudo marcar.
    expect(prisma.plantillaMensaje.findFirst).not.toHaveBeenCalled();
  });
});
