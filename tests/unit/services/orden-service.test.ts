import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { OrdenService } from "@/lib/services/OrdenService";
import {
  NumRemisionDuplicadoError,
  type IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO, OrdenListItemDTO } from "@/lib/types/orden";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const OTRA_TIENDA_ID = "store2";
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function dto(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "ord-1",
    numGuia: 1,
    numRemision: "REM-1",
    estatusId: "os-bodega",
    estatusValue: "en_bodega",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "store1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1.5,
    notas: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// R25/R26: elemento del listado = OrdenDTO + tiendaNombre (nombre legible tienda).
function listItem(overrides: Partial<OrdenListItemDTO> = {}): OrdenListItemDTO {
  return { ...dto(), tiendaNombre: "Tienda Uno", ...overrides };
}

// Fixtures de geografia (R14b): por defecto zona->provincia->canton existen, para
// poder ejercitar la creacion (FKs NOT NULL contra tablas creadas vacias).
function buildRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [listItem()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    softDelete: vi.fn().mockResolvedValue(true),
    existsEstatus: vi.fn().mockResolvedValue(true),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-bodega"),
    existsGeo: vi
      .fn()
      .mockResolvedValue({ zona: true, provincia: true, canton: true, distrito: true }),
    // Feature 15: metodos batch de carga masiva, no ejercitados por el CRUD
    // (feature 6) pero exigidos por la interfaz IOrdenRepository.
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findProvinciasByNombres: vi.fn().mockResolvedValue([]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([]),
    findMensajerosByIds: vi.fn().mockResolvedValue(new Set()),
    createManyOrdenes: vi.fn().mockResolvedValue(0),
    // Feature 16: metodos de resumen/asignacion, no ejercitados por el CRUD
    // (feature 6) pero exigidos por la interfaz IOrdenRepository.
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    asignarMensajeroSugerido: vi.fn().mockResolvedValue(0),
    countOrdenesDeTienda: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function crearInput(overrides: Record<string, unknown> = {}) {
  return {
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    peso: 1.5,
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    tiendaId: "store1",
    ...overrides,
  };
}

let repo: IOrdenRepository;
let service: OrdenService;

beforeEach(() => {
  repo = buildRepo();
  service = new OrdenService(repo);
});

describe("crear — matriz de autorizacion", () => {
  it("R20: maestro/admin crean cualquier orden", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await service.crear(crearInput({ tiendaId: "storeX" }), actor);
      expect(r.status).toBe("ok");
    }
  });

  it("R21: adminTienda crea forzando tiendaId=actor.usuarioId", async () => {
    const r = await service.crear(crearInput({ tiendaId: undefined }), TIENDA);
    expect(r.status).toBe("ok");
    const data = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.tiendaId).toBe("store1");
  });

  it("R22: adminTienda con tiendaId ajeno -> forbidden y no crea", async () => {
    const r = await service.crear(crearInput({ tiendaId: OTRA_TIENDA_ID }), TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R23: mensajero no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R24: rol no reconocido -> forbidden", async () => {
    const r = await service.crear(crearInput(), DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("maestro/admin sin tiendaId -> validation_error (R11)", async () => {
    const r = await service.crear(crearInput({ tiendaId: undefined }), MAESTRO);
    expect(r.status).toBe("validation_error");
  });
});

describe("crear — validacion de FKs y defaults", () => {
  it("R27/R7/R8: sin estatusId aplica default GLOBAL en_preparacion y delega en el repo", async () => {
    const r = await service.crear(crearInput({ estatusId: undefined }), TIENDA);
    expect(r.status).toBe("ok");
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    const data = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.estatusId).toBe("os-bodega");
  });

  it("R26/R12: geografia inexistente -> validation_error por campo, no crea", async () => {
    repo = buildRepo({
      existsGeo: vi
        .fn()
        .mockResolvedValue({ zona: false, provincia: true, canton: false, distrito: true }),
    });
    service = new OrdenService(repo);

    const r = await service.crear(crearInput(), TIENDA);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("zonaId");
      expect(r.fieldErrors).toHaveProperty("cantonId");
      expect(r.fieldErrors).not.toHaveProperty("provinciaId");
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R26: estatusId provisto inexistente -> validation_error", async () => {
    repo = buildRepo({ existsEstatus: vi.fn().mockResolvedValue(false) });
    service = new OrdenService(repo);

    const r = await service.crear(crearInput({ estatusId: "os-x" }), TIENDA);
    expect(r.status).toBe("validation_error");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R28: num_remision duplicado -> conflict", async () => {
    repo = buildRepo({
      create: vi.fn().mockRejectedValue(new NumRemisionDuplicadoError("REM-1")),
    });
    service = new OrdenService(repo);

    const r = await service.crear(crearInput(), TIENDA);
    expect(r.status).toBe("conflict");
  });
});

describe("obtener", () => {
  it("R20: maestro obtiene cualquier orden", async () => {
    const r = await service.obtener("ord-1", MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("R21: adminTienda obtiene la suya", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store1" })) });
    service = new OrdenService(repo);
    const r = await service.obtener("ord-1", TIENDA);
    expect(r.status).toBe("ok");
  });

  it("R21/R29: adminTienda con orden ajena -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store2" })) });
    service = new OrdenService(repo);
    const r = await service.obtener("ord-1", TIENDA);
    expect(r.status).toBe("not_found");
  });

  it("R29/R34: inexistente o borrada -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new OrdenService(repo);
    const r = await service.obtener("x", MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("R24: rol desconocido -> forbidden", async () => {
    const r = await service.obtener("ord-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });
});

describe("listar", () => {
  it("R30: devuelve items/page/pageSize/total", async () => {
    const r = await service.listar(
      { page: 2, pageSize: 10, sortBy: "created_at", sortDir: "desc" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.page).toBe(2);
      expect(r.pageSize).toBe(10);
      expect(r.total).toBe(1);
    }
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.skip).toBe(10); // (page-1)*pageSize
    expect(arg.take).toBe(10);
  });

  it("R21: adminTienda inyecta su tiendaId en el where", async () => {
    await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.tiendaId).toBe("store1");
  });

  it("R25/R26: propaga tiendaNombre de los items sin re-filtrar (R22 intacto)", async () => {
    repo = buildRepo({
      list: vi.fn().mockResolvedValue({
        items: [listItem({ tiendaNombre: "Tienda Uno" })],
        total: 1,
      }),
    });
    service = new OrdenService(repo);

    const r = await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items[0].tiendaNombre).toBe("Tienda Uno");
    }
    // R22: la autorizacion por rol NO cambia; adminTienda sigue forzando su tiendaId.
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.tiendaId).toBe("store1");
  });

  it("R31: propaga filtro estatusId y orden al repo", async () => {
    await service.listar(
      { page: 1, pageSize: 20, estatusId: "os-entregada", sortBy: "num_guia", sortDir: "asc" },
      MAESTRO,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBe("os-entregada");
    expect(arg.sortBy).toBe("num_guia");
    expect(arg.sortDir).toBe("asc");
  });

  it("R24: rol desconocido -> forbidden", async () => {
    const r = await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      DESCONOCIDO,
    );
    expect(r.status).toBe("forbidden");
  });
});

describe("actualizar", () => {
  it("R37: maestro aplica solo los campos presentes y delega", async () => {
    const r = await service.actualizar("ord-1", { producto: "Nuevo", notas: "x" }, MAESTRO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ producto: "Nuevo", notas: "x" });
  });

  it("R23/R41: mensajero solo estatusId -> ok", async () => {
    const r = await service.actualizar("ord-1", { estatusId: "os-entregada" }, MENSAJERO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ estatusId: "os-entregada" });
  });

  it("R23: mensajero con otro campo -> forbidden, no actualiza", async () => {
    const r = await service.actualizar(
      "ord-1",
      { estatusId: "os-entregada", producto: "Hack" },
      MENSAJERO,
    );
    expect(r.status).toBe("forbidden");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R21: adminTienda actualiza la suya", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store1" })) });
    service = new OrdenService(repo);
    const r = await service.actualizar("ord-1", { producto: "N" }, TIENDA);
    expect(r.status).toBe("ok");
  });

  it("R21: adminTienda sobre orden ajena -> forbidden", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store2" })) });
    service = new OrdenService(repo);
    const r = await service.actualizar("ord-1", { producto: "N" }, TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R36/R40: orden inexistente/borrada -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new OrdenService(repo);
    const r = await service.actualizar("x", { producto: "N" }, MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("R38: estatusId inexistente -> validation_error", async () => {
    repo = buildRepo({ existsEstatus: vi.fn().mockResolvedValue(false) });
    service = new OrdenService(repo);
    const r = await service.actualizar("ord-1", { estatusId: "os-x" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("borrar", () => {
  it("R39: maestro borra (soft delete) -> ok", async () => {
    const r = await service.borrar("ord-1", MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.softDelete).toHaveBeenCalledWith("ord-1");
  });

  it("R41: mensajero no puede borrar -> forbidden", async () => {
    const r = await service.borrar("ord-1", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("R21: adminTienda borra la suya", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store1" })) });
    service = new OrdenService(repo);
    const r = await service.borrar("ord-1", TIENDA);
    expect(r.status).toBe("ok");
  });

  it("R21: adminTienda sobre ajena -> forbidden", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store2" })) });
    service = new OrdenService(repo);
    const r = await service.borrar("ord-1", TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("R40: inexistente/borrada -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new OrdenService(repo);
    const r = await service.borrar("x", MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("R24: rol desconocido -> forbidden", async () => {
    const r = await service.borrar("ord-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });
});
