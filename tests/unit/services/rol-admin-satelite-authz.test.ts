import { describe, it, expect, vi } from "vitest";
import { OrdenService } from "@/lib/services/OrdenService";
import { TarifaService } from "@/lib/services/TarifaService";
import { AsignacionMensajeroService } from "@/lib/services/AsignacionMensajeroService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ITarifaRepository } from "@/lib/interfaces/repositories/ITarifaRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor as OrdenActor } from "@/lib/interfaces/services/IOrdenService";
import type { Actor as TarifaActor } from "@/lib/interfaces/services/ITarifaService";
import type { OrdenDTO, OrdenListItemDTO } from "@/lib/types/orden";
import type { TarifaDTO } from "@/lib/types/tarifa";
import type { RawRow } from "@/lib/parsers/spreadsheet";

// Feature 19 (rol-adminsatelite): R9, R10, R11. `adminSatelite` es un rol SIN
// permisos nuevos: en toda puerta de autorizacion por rol existente debe caer
// en el default-forbidden (sin cambios de codigo de servicio, verificado en
// design.md). Este test cubre las cuatro puertas listadas en el spec y un caso
// de no-regresion por servicio con un rol previamente autorizado.

const ADMIN_SATELITE_ORDEN: OrdenActor = { usuarioId: "sat1", rol: "adminSatelite" };
const ADMIN_SATELITE_TARIFA: TarifaActor = { usuarioId: "sat1", rol: "adminSatelite" };
const MAESTRO_ORDEN: OrdenActor = { usuarioId: "m1", rol: "maestro" };
const MAESTRO_TARIFA: TarifaActor = { usuarioId: "m1", rol: "maestro" };
const TIENDA_ORDEN: OrdenActor = { usuarioId: "store1", rol: "adminTienda" };

function ordenDto(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
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

function ordenListItem(overrides: Partial<OrdenListItemDTO> = {}): OrdenListItemDTO {
  return { ...ordenDto(), tiendaNombre: "Tienda Uno", ...overrides };
}

function buildOrdenRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    create: vi.fn().mockResolvedValue(ordenDto()),
    findById: vi.fn().mockResolvedValue(ordenDto()),
    list: vi.fn().mockResolvedValue({ items: [ordenListItem()], total: 1 }),
    update: vi.fn().mockResolvedValue(ordenDto()),
    softDelete: vi.fn().mockResolvedValue(true),
    existsEstatus: vi.fn().mockResolvedValue(true),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-bodega"),
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false), // feature 27
    existsGeo: vi
      .fn()
      .mockResolvedValue({ zona: true, provincia: true, canton: true, distrito: true }),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([]),
    findMensajerosByIds: vi.fn().mockResolvedValue(new Set()),
    createManyOrdenes: vi.fn().mockResolvedValue(0),
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
    ...overrides,
  };
}

function crearOrdenInput(overrides: Record<string, unknown> = {}) {
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

function tarifaDto(overrides: Partial<TarifaDTO> = {}): TarifaDTO {
  return {
    id: "cob-1",
    // El modelo de tarifa cuelga de la tienda (adminTienda) + status; ya no hay
    // nombre/zonaId.
    tiendaId: "store1",
    status: "activo",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function buildTarifaRepo(overrides: Partial<ITarifaRepository> = {}): ITarifaRepository {
  return {
    create: vi.fn().mockResolvedValue(tarifaDto()),
    findById: vi.fn().mockResolvedValue(tarifaDto()),
    list: vi.fn().mockResolvedValue({ items: [tarifaDto()], total: 1 }),
    update: vi.fn().mockResolvedValue(tarifaDto()),
    softDelete: vi.fn().mockResolvedValue(true),
    // La tienda referenciada debe ser adminTienda: por default valida (true), para
    // que el camino feliz del maestro dependa solo de su rol, no de este invariante.
    esTiendaAdminTienda: vi.fn().mockResolvedValue(true),
    inactivarPorTienda: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function crearTarifaInput(overrides: Record<string, unknown> = {}) {
  return {
    tiendaId: "store1",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
    ...overrides,
  };
}

function buildUserRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
  return {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    listMensajeros: vi.fn().mockResolvedValue([{ id: "msg-1", nombre: "Ana" }]),
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

function bulkRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "",
    direccion: "",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    mensajero_sugerido_id: "",
    ...overrides,
  };
}

describe("OrdenService.crear — adminSatelite sin permisos nuevos (R9, R11)", () => {
  it("adminSatelite -> forbidden, no crea", async () => {
    const repo = buildOrdenRepo();
    const service = new OrdenService(repo);

    const r = await service.crear(crearOrdenInput(), ADMIN_SATELITE_ORDEN);

    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("no-regresion: maestro conserva su resultado exitoso (R11)", async () => {
    const repo = buildOrdenRepo();
    const service = new OrdenService(repo);

    const r = await service.crear(crearOrdenInput({ tiendaId: "storeX" }), MAESTRO_ORDEN);

    expect(r.status).toBe("ok");
  });
});

describe("TarifaService — adminSatelite sin permisos nuevos (R9, R11)", () => {
  it("lectura (obtener): adminSatelite -> forbidden, no consulta el repo", async () => {
    const repo = buildTarifaRepo();
    const service = new TarifaService(repo);

    const r = await service.obtener("cob-1", ADMIN_SATELITE_TARIFA);

    expect(r.status).toBe("forbidden");
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("escritura (crear): adminSatelite -> forbidden, no persiste", async () => {
    const repo = buildTarifaRepo();
    const service = new TarifaService(repo);

    const r = await service.crear(crearTarifaInput(), ADMIN_SATELITE_TARIFA);

    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
    // La puerta de rol corta ANTES de cualquier acceso al repo: un adminSatelite no
    // debe poder sondear que tiendas son adminTienda via esta ruta.
    expect(repo.esTiendaAdminTienda).not.toHaveBeenCalled();
  });

  it("no-regresion: maestro conserva su resultado exitoso en lectura y escritura (R11)", async () => {
    const repo = buildTarifaRepo();
    const service = new TarifaService(repo);

    const rLectura = await service.obtener("cob-1", MAESTRO_TARIFA);
    expect(rLectura.status).toBe("ok");

    const rEscritura = await service.crear(crearTarifaInput(), MAESTRO_TARIFA);
    expect(rEscritura.status).toBe("ok");
  });
});

describe("AsignacionMensajeroService.listarMensajeros — adminSatelite sin permisos nuevos (R9, R11)", () => {
  it("adminSatelite -> forbidden, no consulta el repo", async () => {
    const userRepo = buildUserRepo();
    const service = new AsignacionMensajeroService(userRepo, buildOrdenRepo());

    const r = await service.listarMensajeros(ADMIN_SATELITE_ORDEN);

    expect(r.status).toBe("forbidden");
    expect(userRepo.listMensajeros).not.toHaveBeenCalled();
  });

  it("no-regresion: adminTienda conserva su resultado exitoso (R11)", async () => {
    const userRepo = buildUserRepo();
    const service = new AsignacionMensajeroService(userRepo, buildOrdenRepo());

    const r = await service.listarMensajeros(TIENDA_ORDEN);

    expect(r.status).toBe("ok");
  });
});

describe("BulkOrdenService.cargarMasiva — adminSatelite sin permisos nuevos (R9, R11)", () => {
  it("adminSatelite -> forbidden, no toca datos", async () => {
    const repo = buildOrdenRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([bulkRow()], ADMIN_SATELITE_ORDEN);

    expect(r.status).toBe("forbidden");
    expect(repo.findExistingRemisiones).not.toHaveBeenCalled();
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });

  it("no-regresion: adminTienda conserva su resultado exitoso (R11)", async () => {
    const repo = buildOrdenRepo();
    const service = new BulkOrdenService(repo);

    const r = await service.cargarMasiva([bulkRow()], TIENDA_ORDEN);

    expect(r.status).toBe("ok");
  });
});
