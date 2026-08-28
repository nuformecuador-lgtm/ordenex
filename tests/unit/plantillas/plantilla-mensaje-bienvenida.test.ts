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

/**
 * Por defecto la fila existe y esta `activo`: el unico estado desde el que se puede marcar
 * (2026-08-27). Los casos que prueban el rechazo pisan `findById` con otro estado.
 */
function repoFalso(overrides: Partial<IPlantillaMensajeRepository> = {}) {
  return {
    findById: vi.fn().mockResolvedValue(plantilla({ estado: "activo" })),
    marcarWelcomeMessage: vi
      .fn()
      .mockResolvedValue(plantilla({ estado: "activo", welcomeMessage: true })),
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

  // DEROGADO 2026-08-27 (pedido humano). Aqui vivia «se permite desde CUALQUIER estado: un
  // borrador sin aprobar tambien se puede elegir», con el argumento de que exigir la
  // aprobacion de Meta dejaria el ajuste inaccesible al configurar el modulo. Lo que ese
  // argumento no miraba: la bienvenida se envia SOLA al recoger el paquete, sin nadie delante.
  // Marcar un borrador no dejaba el ajuste accesible, dejaba configurado un silencio —el
  // cliente no recibia nada y no habia pantalla donde avisarlo—. Los `it.each` de abajo son
  // ahora la afirmacion contraria, estado por estado.
  it.each([
    ["saved_not_aprobation"],
    ["pending"],
    ["refused"],
    ["inactivo"],
  ] as const)(
    "estado_invalido desde `%s`: NO se marca, y el repositorio ni se toca",
    async (estado) => {
      const repo = repoFalso({ findById: vi.fn().mockResolvedValue(plantilla({ estado })) });
      const service = new PlantillaMensajeService(repo);

      const r = await service.marcarMensajeBienvenida("pl-1", MAESTRO);

      expect(r.status).toBe("estado_invalido");
      // El estado viaja en la respuesta: es lo que permite a la UI decir CUAL es el problema.
      if (r.status === "estado_invalido") expect(r.estado).toBe(estado);
      // Y lo que de verdad importa: la escritura no ocurrio.
      expect(repo.marcarWelcomeMessage).not.toHaveBeenCalled();
    },
  );

  it("desde `activo` si se marca (el unico estado que lo permite)", async () => {
    const repo = repoFalso({
      findById: vi.fn().mockResolvedValue(plantilla({ estado: "activo" })),
    });
    const service = new PlantillaMensajeService(repo);

    const r = await service.marcarMensajeBienvenida("pl-1", MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.marcarWelcomeMessage).toHaveBeenCalledWith("pl-1");
  });

  it("carrera perdida: existia y estaba activa, pero la borraron antes del SET -> not_found", async () => {
    // `findById` y `marcarWelcomeMessage` son dos viajes a la base. Que el segundo devuelva
    // null NO puede reportarse como `estado_invalido`: la plantilla ya no esta, y el maestro
    // tiene que ver «no existe» para que el refresco del listado tenga sentido.
    const repo = repoFalso({ marcarWelcomeMessage: vi.fn().mockResolvedValue(null) });
    const service = new PlantillaMensajeService(repo);

    expect((await service.marcarMensajeBienvenida("pl-1", MAESTRO)).status).toBe("not_found");
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
    // Lo decide el `findById` previo, que es tambien quien lee el estado: una sola lectura
    // resuelve «no existe» y «existe pero no esta activa» sin confundirlas.
    const repo = repoFalso({ findById: vi.fn().mockResolvedValue(null) });
    const service = new PlantillaMensajeService(repo);

    const r = await service.marcarMensajeBienvenida("nope", MAESTRO);

    expect(r.status).toBe("not_found");
    expect(repo.marcarWelcomeMessage).not.toHaveBeenCalled();
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

  it("`estado_invalido` viaja INTACTO a la UI, con su estado", async () => {
    // Sin este caso, `estado_invalido` caeria por el `toPlantillaActionError` y la UI recibiria
    // un error generico: la razon por la que no se pudo se perderia justo en el borde.
    const plantillaService = servicioFalso({
      marcarMensajeBienvenida: vi
        .fn()
        .mockResolvedValue({ status: "estado_invalido", estado: "pending" }),
    });

    const r = await marcarPlantillaBienvenida("pl-1", {
      plantillaService,
      getActor: async () => MAESTRO,
    });

    expect(r).toEqual({ status: "estado_invalido", estado: "pending" });
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

// SALIR DE `activo` DESMARCA LA BIENVENIDA (pedido humano 2026-08-27).
//
// La regla vive en `updateEstado` y no en cada service A PROPOSITO: por este unico metodo
// pasan los TRES caminos que mueven el estado —desactivar, enviar a aprobacion, y el
// reintento de propagacion a Meta—. Ponerla en los services obligaria a que los tres se
// acuerden, y el que se olvide dejara la marca colgando de una plantilla que ya no se puede
// enviar: el negocio creeria tener bienvenida y el cliente no recibiria nada.
describe("repositorio.updateEstado — la marca de bienvenida no sobrevive a salir de `activo`", () => {
  function prismaEspia() {
    const escrituras: Array<{ where: unknown; data: unknown }> = [];
    const prisma = {
      plantillaMensaje: {
        updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
          escrituras.push(args);
          return { count: 1 };
        }),
        findFirst: vi.fn(async () => ({ ...plantilla(), variablesNombres: {} })),
      },
    };
    return { prisma, escrituras };
  }

  function repoCon(prisma: unknown) {
    return new PlantillaMensajeRepository(
      prisma as ConstructorParameters<typeof PlantillaMensajeRepository>[0],
    );
  }

  it.each([["inactivo"], ["pending"], ["refused"], ["saved_not_aprobation"]] as const)(
    "hacia `%s`: la misma escritura que mueve el estado limpia la marca",
    async (estado) => {
      const { prisma, escrituras } = prismaEspia();

      await repoCon(prisma).updateEstado("pl-1", estado);

      // UNA escritura, no dos: no hay ventana en la que la fila este inactiva y aun marcada.
      expect(escrituras).toHaveLength(1);
      expect(escrituras[0]).toEqual({
        where: { id: "pl-1", deletedAt: null },
        data: { estado, welcomeMessage: false },
      });
    },
  );

  it("hacia `activo`: NO toca la marca (reactivar no re-marca a nadie)", async () => {
    // El reverso importa tanto como la regla: si `updateEstado` escribiera `welcomeMessage`
    // tambien al reactivar, tendria que decidir con que valor —y `true` resucitaria una marca
    // que alguien retiro, `false` desmarcaria la bienvenida vigente al reactivar cualquier
    // otra plantilla—. La respuesta correcta es no tocarla.
    const { prisma, escrituras } = prismaEspia();

    await repoCon(prisma).updateEstado("pl-1", "activo");

    expect(escrituras[0].data).toEqual({ estado: "activo" });
    expect(escrituras[0]).not.toHaveProperty("data.welcomeMessage");
  });
});
// EL LECTOR DE LA MARCA. `findWelcomeMessage` es lo que consulta el encolado del envio
// automatico, y su filtro CORTO es la decision de diseno, no un descuido: ver
// `PlantillaBienvenida`.
describe("PlantillaMensajeRepository.findWelcomeMessage", () => {
  interface ArgFindFirst {
    where: Record<string, unknown>;
  }

  function prismaLector(fila: unknown) {
    return {
      plantillaMensaje: { findFirst: vi.fn(async (arg: ArgFindFirst) => (arg ? fila : fila)) },
      $transaction: vi.fn(),
    };
  }

  function construir(prisma: unknown) {
    return new PlantillaMensajeRepository(
      prisma as ConstructorParameters<typeof PlantillaMensajeRepository>[0],
    );
  }

  it("filtra por la marca y por vigente, y por NADA MAS", async () => {
    // Este es el test que protege la politica de rastro. Si alguien anade aqui
    // `estado: "activo"` o `NOT: { templateId: null }` —copiando `findEnviableById`, que es la
    // tentacion— una plantilla marcada pero no aprobada por Meta devolveria `null`, el encolado
    // la leeria como "no hay bienvenida configurada" y NO ENCOLARIA NADA. El fallo de
    // configuracion se volveria invisible, que es justo lo que esta feature existe para evitar:
    // el boton de la UI ya le prometio al maestro que el envio es automatico.
    const prisma = prismaLector(null);
    await construir(prisma).findWelcomeMessage();

    expect(prisma.plantillaMensaje.findFirst.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      welcomeMessage: true,
    });
  });

  it("devuelve la marcada AUNQUE no sea enviable, con su estado y su templateId", async () => {
    const prisma = prismaLector({
      id: "pl-1",
      nombre: "Bienvenida",
      templateId: null,
      estado: "pending",
    });

    expect(await construir(prisma).findWelcomeMessage()).toEqual({
      id: "pl-1",
      nombre: "Bienvenida",
      templateId: null, // el handler lo cita como motivo: "no propagada a Meta"
      estado: "pending", // idem: "esta en estado pending, no activo"
    });
  });

  it("null cuando nadie la marco (silencio: el negocio no la configuro)", async () => {
    expect(await construir(prismaLector(null)).findWelcomeMessage()).toBeNull();
  });
});
