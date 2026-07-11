import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function buildRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    existsEstatus: vi.fn(),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-preparacion"),
    // Feature 27: por defecto la tienda NO tiene fulfillment -> en_preparacion (R17/R22).
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    existsGeo: vi.fn(),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findProvinciasByNombres: vi.fn().mockResolvedValue([
      { id: "p1", nombre: "Pichincha" },
    ]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([
      { id: "c1", nombre: "Quito", provinciaId: "p1" },
    ]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([
      { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1" },
    ]),
    findMensajerosByIds: vi.fn().mockResolvedValue(new Set(["msg-1"])),
    createManyOrdenes: vi.fn().mockResolvedValue(0),
    // Feature 16: metodos de resumen/asignacion, no ejercitados por la carga
    // masiva (feature 15) pero exigidos por la interfaz IOrdenRepository.
    // Feature 17: metodos de "Generar guia"/asignacion, no ejercitados por la
    // carga masiva (feature 15) pero exigidos por la interfaz IOrdenRepository.
    findByIdsForTransicion: vi.fn().mockResolvedValue([]),
    findMensajeroIdsValidos: vi.fn().mockResolvedValue(new Set()),
    findAllMensajeros: vi.fn().mockResolvedValue([]),
    listOrderStatus: vi.fn().mockResolvedValue([]),
    generarGuiaLote: vi.fn().mockResolvedValue([]),
    asignarBodegaLote: vi.fn().mockResolvedValue(0),
    findMensajerosGam: vi.fn().mockResolvedValue([]),
    findMensajeroIdsValidosGam: vi.fn().mockResolvedValue(new Set()),
    rutearBodegaSateliteLote: vi.fn().mockResolvedValue(0),
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    asignarMensajeroSugerido: vi.fn().mockResolvedValue(0),
    countOrdenesDeTienda: vi.fn().mockResolvedValue(0),
    // Feature 32: etiqueta de guia, exigida por la interfaz IOrdenRepository.
    findEtiquetasByIds: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "La Mariscal",
    direccion: "",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    mensajero_sugerido_id: "",
    ...overrides,
  };
}

function createManyArg(repo: IOrdenRepository) {
  return (repo.createManyOrdenes as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

describe("BulkOrdenService.cargarMasiva — autorizacion (R11)", () => {
  it.each([MAESTRO, ADMIN, MENSAJERO, DESCONOCIDO])(
    "rol %o distinto de adminTienda -> forbidden sin tocar datos",
    async (actor) => {
      const repo = buildRepo();
      const service = new BulkOrdenService(repo);

      const r = await service.cargarMasiva([row()], actor);

      expect(r.status).toBe("forbidden");
      expect(repo.findExistingRemisiones).not.toHaveBeenCalled();
      expect(repo.findProvinciasByNombres).not.toHaveBeenCalled();
      expect(repo.createManyOrdenes).not.toHaveBeenCalled();
    },
  );

  it("adminTienda si es autorizado", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
  });
});

describe("BulkOrdenService.cargarMasiva — tienda del actor (R24)", () => {
  it("fija tienda_id=actor.usuarioId en todas las ordenes creadas", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    await service.cargarMasiva([row({ num_remision: "REM-A" }), row({ num_remision: "REM-B" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg).toHaveLength(2);
    expect(arg[0].tiendaId).toBe("store1");
    expect(arg[1].tiendaId).toBe("store1");
  });
});

describe("BulkOrdenService.cargarMasiva — campos obligatorios (R18)", () => {
  it("fila sin destinatario -> error de fila, sin abortar el resto", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row({ destinatario: "" })], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[0].errores).toHaveProperty("destinatario");
    }
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });
});

describe("BulkOrdenService.cargarMasiva — geografia (R19/R20/R21)", () => {
  it("provincia inexistente -> error de fila con fieldError geografico", async () => {
    const repo = buildRepo({ findProvinciasByNombres: vi.fn().mockResolvedValue([]) });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("provincia");
    }
  });

  it("canton ambiguo dentro de la provincia -> error de fila", async () => {
    const repo = buildRepo({
      findCantonesByProvinciaIds: vi.fn().mockResolvedValue([
        { id: "c1", nombre: "Quito", provinciaId: "p1" },
        { id: "c2", nombre: "Quito", provinciaId: "p1" },
      ]),
    });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("canton");
    }
  });

  it("canton no encontrado dentro de la provincia -> error de fila", async () => {
    const repo = buildRepo({ findCantonesByProvinciaIds: vi.fn().mockResolvedValue([]) });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row({ canton: "Otro" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("canton");
    }
  });

  it("deriva zonaId desde el distrito resuelto", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    await service.cargarMasiva([row()], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].zonaId).toBe("z1");
    expect(arg[0].provinciaId).toBe("p1");
    expect(arg[0].cantonId).toBe("c1");
    expect(arg[0].distritoId).toBe("d1");
  });

  it("sin distrito -> error de fila (la zona se deriva del distrito)", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row({ distrito: "" })], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("distrito");
    }
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });

  it("distrito sin zona asignada -> error de fila", async () => {
    const repo = buildRepo({
      findDistritosByCantonIds: vi.fn().mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: null },
      ]),
    });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("distrito");
    }
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });

  it("distrito provisto pero inexistente en el canton -> error de fila", async () => {
    const repo = buildRepo({ findDistritosByCantonIds: vi.fn().mockResolvedValue([]) });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row({ distrito: "La Mariscal" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("distrito");
    }
  });
});

describe("BulkOrdenService.cargarMasiva — mensajero sugerido (R22)", () => {
  it("vacio -> persiste null", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    await service.cargarMasiva([row({ mensajero_sugerido_id: "" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].mensajeroSugeridoId).toBeNull();
  });

  it("id valido con rol mensajero -> se persiste", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    await service.cargarMasiva([row({ mensajero_sugerido_id: "msg-1" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].mensajeroSugeridoId).toBe("msg-1");
  });

  it("id inexistente o sin rol mensajero -> error de fila", async () => {
    const repo = buildRepo({ findMensajerosByIds: vi.fn().mockResolvedValue(new Set()) });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row({ mensajero_sugerido_id: "no-existe" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("mensajero_sugerido_id");
    }
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });
});

describe("BulkOrdenService.cargarMasiva — monto_cobrar (R23)", () => {
  it("vacio -> persiste null", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    await service.cargarMasiva([row({ monto_cobrar: "" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].montoCobrar).toBeNull();
  });

  it("numerico valido -> se persiste como number", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    await service.cargarMasiva([row({ monto_cobrar: "12.50" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].montoCobrar).toBe(12.5);
  });

  it("no numerico -> error de fila", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row({ monto_cobrar: "abc" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
  });

  it("negativo -> error de fila", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row({ monto_cobrar: "-5" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
  });
});

describe("BulkOrdenService.cargarMasiva — deduplicacion (R25/R26)", () => {
  it("R25: remision existente en DB -> duplicada con el estatus de la orden existente", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-1", "entregada"]])),
    });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.duplicadas).toBe(1);
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.filas[0]).toMatchObject({ resultado: "duplicada", estatus: "entregada" });
    }
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });

  it("R26: duplicado intra-archivo -> una creada (primera), el resto duplicada", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row(), row(), row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.duplicadas).toBe(2);
      expect(r.summary.filas[0].resultado).toBe("creada");
      expect(r.summary.filas[1].resultado).toBe("duplicada");
      expect(r.summary.filas[2].resultado).toBe("duplicada");
      // R30: la duplicada intra-archivo tambien expone estatus (el de la ganadora).
      expect(r.summary.filas[1].estatus).toBe("en_preparacion");
    }
    const arg = createManyArg(repo);
    expect(arg).toHaveLength(1);
  });
});

describe("BulkOrdenService.cargarMasiva — estatus por defecto (R7)", () => {
  it("resuelve en_preparacion como estatus de las filas creadas", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("en_preparacion");
    }
    const arg = createManyArg(repo);
    expect(arg[0].estatusId).toBe("os-preparacion");
  });

  it("estatus por defecto no disponible -> todas las filas quedan en error, sin persistir", async () => {
    const repo = buildRepo({ findEstatusIdByValue: vi.fn().mockResolvedValue(null) });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.conError).toBe(1);
    }
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });
});

describe("BulkOrdenService.cargarMasiva — estatus inicial condicional por fulfillment (feature 27/R16/R17/R18/R19/R20)", () => {
  it("R16: tienda con fulfillment=true -> ordenes en_fulfillment", async () => {
    const repo = buildRepo({
      findUsuarioFulfillment: vi.fn().mockResolvedValue(true),
      findEstatusIdByValue: vi.fn().mockResolvedValue("os-fulfillment"),
    });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_fulfillment"); // R16/R20
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("en_fulfillment"); // R19
    }
    const arg = createManyArg(repo);
    expect(arg[0].estatusId).toBe("os-fulfillment");
  });

  it("R17: tienda con fulfillment=false -> ordenes en_preparacion (no-regresion)", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(false) });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion"); // R17
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("en_preparacion");
    }
  });

  it("R15/R18: lee fulfillment de la tienda del actor UNA vez por lote", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    const service = new BulkOrdenService(repo);

    await service.cargarMasiva(
      [row({ num_remision: "A" }), row({ num_remision: "B" }), row({ num_remision: "C" })],
      TIENDA,
    );

    expect(repo.findUsuarioFulfillment).toHaveBeenCalledTimes(1); // R18
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledWith("store1"); // R15: actor.usuarioId
  });

  it("R19: el estatus resuelto se reporta tambien en duplicadas intra-archivo", async () => {
    const repo = buildRepo({
      findUsuarioFulfillment: vi.fn().mockResolvedValue(true),
      findEstatusIdByValue: vi.fn().mockResolvedValue("os-fulfillment"),
    });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row(), row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("en_fulfillment");
      expect(r.summary.filas[1]).toMatchObject({ resultado: "duplicada", estatus: "en_fulfillment" });
    }
  });

  it("R20: estatus en_fulfillment inexistente -> 0 creadas, error de estatus por fila", async () => {
    const repo = buildRepo({
      findUsuarioFulfillment: vi.fn().mockResolvedValue(true),
      findEstatusIdByValue: vi.fn().mockResolvedValue(null),
    });
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[0].errores).toHaveProperty("estatus");
    }
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });
});

describe("BulkOrdenService.cargarMasiva — exito parcial (R29)", () => {
  it("filas invalidas no bloquean la persistencia de las validas", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo);

    const rows = [
      row({ num_remision: "REM-A" }),
      row({ num_remision: "REM-B", destinatario: "" }), // invalida
    ];
    const r = await service.cargarMasiva(rows, TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.total).toBe(2);
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(1);
    }
    const arg = createManyArg(repo);
    expect(arg).toHaveLength(1);
    expect(arg[0].numRemision).toBe("REM-A");
  });
});
