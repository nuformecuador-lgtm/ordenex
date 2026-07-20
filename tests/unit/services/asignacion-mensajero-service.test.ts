import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { AsignacionMensajeroService } from "@/lib/services/AsignacionMensajeroService";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function buildUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
  return {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    listMensajeros: vi
      .fn()
      .mockResolvedValue([{ id: "msg-1", nombre: "Ana", zonaId: "z1", zonaNombre: "Norte" }]),
    listByRol: vi.fn().mockResolvedValue([]), // exigido por IUserRepository; no ejercitado aqui
    updatePasswordHash: vi.fn(),
    list: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    setEstado: vi.fn(),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn(),
    ...overrides,
  };
}

function buildOrdenRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsEstatus: vi.fn(),
    findEstatusIdByValue: vi.fn(),
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false), // feature 27
    existsGeo: vi.fn(),
    findExistingRemisiones: vi.fn(),
    findAllProvincias: vi.fn(),
    findCantonesByProvinciaIds: vi.fn(),
    findDistritosByCantonIds: vi.fn(),
    findMensajerosByIds: vi.fn().mockResolvedValue(new Set(["msg-1", "msg-2"])),
    createManyOrdenes: vi.fn(),
    createManyOrdenesConGuia: vi.fn().mockResolvedValue([]), // feature 88
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    asignarMensajeroSugerido: vi.fn().mockResolvedValue(0),
    countOrdenesDeTienda: vi.fn().mockResolvedValue(0),
    // Feature 17: metodos de "Generar guia"/asignacion, no ejercitados aqui
    // pero exigidos por la interfaz IOrdenRepository.
    findByIdsForTransicion: vi.fn().mockResolvedValue([]),
    findByNumGuiaForTransicion: vi.fn().mockResolvedValue(null),
    findMensajeroIdsValidos: vi.fn().mockResolvedValue(new Set()),
    findAllMensajeros: vi.fn().mockResolvedValue([]),
    listOrderStatus: vi.fn().mockResolvedValue([]),
    generarGuiaLote: vi.fn().mockResolvedValue([]),
    asignarBodegaLote: vi.fn().mockResolvedValue(0),
    findMensajerosByZona: vi.fn().mockResolvedValue([]),
    findMensajeroIdsValidosByZona: vi.fn().mockResolvedValue(new Set()),
    rutearBodegaSateliteLote: vi.fn().mockResolvedValue(0),
    // Feature 41: bloqueo derivado (por defecto nadie bloqueado / bodega libre).
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    findZonasConMensajeroBloqueado: vi.fn(async (): Promise<Set<string>> => new Set()),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    // Feature 32: etiqueta de guia, exigida por la interfaz IOrdenRepository.
    findEtiquetasByIds: vi.fn().mockResolvedValue([]),
    findEtiquetaByNumGuia: vi.fn().mockResolvedValue(null),
    // Feature 33: recepcion en bodega satelite, no ejercitada aqui pero exigida
    // por la interfaz IOrdenRepository.
    findUsuarioZonaId: vi.fn().mockResolvedValue(null),
    findUsuarioVehiculoId: vi.fn().mockResolvedValue(null), // feature 39: exigido por IOrdenRepository
    findRecepcionSateliteByZona: vi.fn().mockResolvedValue([]),
    recibirEnSatelite: vi.fn().mockResolvedValue(false),
    recibirEnOrigen: vi.fn().mockResolvedValue(false),
    recibirLoteEnSatelite: vi.fn().mockResolvedValue(0),
    asignarSateliteLote: vi.fn().mockResolvedValue(0),
    // Feature 87: lista de novedades, no ejercitada aqui pero exigida por IOrdenRepository.
    countDevueltasByTienda: vi.fn().mockResolvedValue(0),
    findDevueltasByTienda: vi.fn().mockResolvedValue([]),
    // Feature 92 (R8/R35): metodos nuevos de lectura de `IOrdenRepository`. Estos
    // tests no ejercitan el gate de coordenadas ni la ruta: devuelven vacio.
    findParaAsignabilidad: vi.fn(async () => []),
    findParadasEnReparto: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn().mockResolvedValue(new Map()),
    ...overrides,
  };
}

describe("AsignacionMensajeroService.listarMensajeros (R1, R5)", () => {
  it.each([TIENDA, MAESTRO, ADMIN])("rol %o autorizado -> ok con la lista del repo", async (actor) => {
    const userRepo = buildUserRepo();
    const service = new AsignacionMensajeroService(userRepo, buildOrdenRepo());

    const r = await service.listarMensajeros(actor);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.mensajeros).toEqual([
        { id: "msg-1", nombre: "Ana", zonaId: "z1", zonaNombre: "Norte" },
      ]);
    }
    expect(userRepo.listMensajeros).toHaveBeenCalledTimes(1);
  });

  it.each([MENSAJERO, DESCONOCIDO])("rol %o no autorizado -> forbidden sin llamar al repo", async (actor) => {
    const userRepo = buildUserRepo();
    const service = new AsignacionMensajeroService(userRepo, buildOrdenRepo());

    const r = await service.listarMensajeros(actor);

    expect(r.status).toBe("forbidden");
    expect(userRepo.listMensajeros).not.toHaveBeenCalled();
  });
});

describe("AsignacionMensajeroService.resumenCargaMasiva (R11)", () => {
  it("adminTienda -> ok con el resumen de su tienda", async () => {
    const ordenRepo = buildOrdenRepo({
      findResumenByNumRemisiones: vi.fn().mockResolvedValue([
        {
          id: "ord-1",
          numGuia: 1,
          numRemision: "REM-1",
          destinatario: "Ana",
          telefonoDest: "099",
          producto: "Caja",
          montoCobrar: null,
          direccion: null,
          mensajeroSugeridoId: null,
          mensajeroSugeridoNombre: null,
        },
      ]),
    });
    const service = new AsignacionMensajeroService(buildUserRepo(), ordenRepo);

    const r = await service.resumenCargaMasiva({ numRemisiones: ["REM-1"] }, TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.ordenes).toHaveLength(1);
    expect(ordenRepo.findResumenByNumRemisiones).toHaveBeenCalledWith(["REM-1"], "store1");
  });

  it.each([MAESTRO, ADMIN, MENSAJERO, DESCONOCIDO])(
    "rol %o distinto de adminTienda -> forbidden sin consultar el repo",
    async (actor) => {
      const ordenRepo = buildOrdenRepo();
      const service = new AsignacionMensajeroService(buildUserRepo(), ordenRepo);

      const r = await service.resumenCargaMasiva({ numRemisiones: ["REM-1"] }, actor);

      expect(r.status).toBe("forbidden");
      expect(ordenRepo.findResumenByNumRemisiones).not.toHaveBeenCalled();
    },
  );
});

describe("AsignacionMensajeroService.asignarMensajeroSugerido (R12-R18)", () => {
  it.each([MAESTRO, ADMIN, MENSAJERO, DESCONOCIDO])(
    "rol %o distinto de adminTienda -> forbidden sin tocar repos",
    async (actor) => {
      const userRepo = buildUserRepo();
      const ordenRepo = buildOrdenRepo();
      const service = new AsignacionMensajeroService(userRepo, ordenRepo);

      const r = await service.asignarMensajeroSugerido(
        { asignaciones: [{ ordenId: "ord-1", mensajeroId: "msg-1" }] },
        actor,
      );

      expect(r.status).toBe("forbidden");
      expect(ordenRepo.findMensajerosByIds).not.toHaveBeenCalled();
      expect(ordenRepo.countOrdenesDeTienda).not.toHaveBeenCalled();
      expect(ordenRepo.asignarMensajeroSugerido).not.toHaveBeenCalled();
    },
  );

  it("R18: asignaciones vacio -> ok con asignadas:0 sin llamar a los repos", async () => {
    const ordenRepo = buildOrdenRepo();
    const service = new AsignacionMensajeroService(buildUserRepo(), ordenRepo);

    const r = await service.asignarMensajeroSugerido({ asignaciones: [] }, TIENDA);

    expect(r).toEqual({ status: "ok", asignadas: 0 });
    expect(ordenRepo.findMensajerosByIds).not.toHaveBeenCalled();
    expect(ordenRepo.countOrdenesDeTienda).not.toHaveBeenCalled();
    expect(ordenRepo.asignarMensajeroSugerido).not.toHaveBeenCalled();
  });

  it("R13: un mensajeroId sin rol mensajero -> validation_error, sin persistir", async () => {
    const ordenRepo = buildOrdenRepo({
      findMensajerosByIds: vi.fn().mockResolvedValue(new Set(["msg-1"])), // msg-2 no es mensajero
    });
    const service = new AsignacionMensajeroService(buildUserRepo(), ordenRepo);

    const r = await service.asignarMensajeroSugerido(
      {
        asignaciones: [
          { ordenId: "ord-1", mensajeroId: "msg-1" },
          { ordenId: "ord-2", mensajeroId: "msg-2" },
        ],
      },
      TIENDA,
    );

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("mensajeroId");
    }
    expect(ordenRepo.countOrdenesDeTienda).not.toHaveBeenCalled();
    expect(ordenRepo.asignarMensajeroSugerido).not.toHaveBeenCalled();
  });

  it("R14: alguna orden no pertenece a la tienda (count < distinct) -> forbidden todo-o-nada, sin persistir", async () => {
    const ordenRepo = buildOrdenRepo({
      findMensajerosByIds: vi.fn().mockResolvedValue(new Set(["msg-1"])),
      countOrdenesDeTienda: vi.fn().mockResolvedValue(1), // se pidieron 2 distintas
    });
    const service = new AsignacionMensajeroService(buildUserRepo(), ordenRepo);

    const r = await service.asignarMensajeroSugerido(
      {
        asignaciones: [
          { ordenId: "ord-1", mensajeroId: "msg-1" },
          { ordenId: "ord-ajena", mensajeroId: "msg-1" },
        ],
      },
      TIENDA,
    );

    expect(r.status).toBe("forbidden");
    expect(ordenRepo.asignarMensajeroSugerido).not.toHaveBeenCalled();
  });

  it("R15: agrupa por mensajeroId distinto, una llamada por grupo, suma counts", async () => {
    const ordenRepo = buildOrdenRepo({
      findMensajerosByIds: vi.fn().mockResolvedValue(new Set(["msg-1", "msg-2"])),
      countOrdenesDeTienda: vi.fn().mockResolvedValue(3),
      asignarMensajeroSugerido: vi
        .fn()
        .mockResolvedValueOnce(2) // grupo msg-1
        .mockResolvedValueOnce(1), // grupo msg-2
    });
    const service = new AsignacionMensajeroService(buildUserRepo(), ordenRepo);

    const r = await service.asignarMensajeroSugerido(
      {
        asignaciones: [
          { ordenId: "ord-1", mensajeroId: "msg-1" },
          { ordenId: "ord-2", mensajeroId: "msg-1" },
          { ordenId: "ord-3", mensajeroId: "msg-2" },
        ],
      },
      TIENDA,
    );

    expect(r).toEqual({ status: "ok", asignadas: 3 });
    expect(ordenRepo.asignarMensajeroSugerido).toHaveBeenCalledTimes(2);
    expect(ordenRepo.asignarMensajeroSugerido).toHaveBeenCalledWith(["ord-1", "ord-2"], "msg-1", "store1");
    expect(ordenRepo.asignarMensajeroSugerido).toHaveBeenCalledWith(["ord-3"], "msg-2", "store1");
  });
});
