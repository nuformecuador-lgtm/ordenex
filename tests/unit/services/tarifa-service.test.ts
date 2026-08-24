import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { TarifaService } from "@/lib/services/TarifaService";
import type { ITarifaRepository } from "@/lib/interfaces/repositories/ITarifaRepository";
import type { Actor } from "@/lib/interfaces/services/ITarifaService";
import type { CrearTarifaInput, TarifaDTO } from "@/lib/types/tarifa";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function dto(overrides: Partial<TarifaDTO> = {}): TarifaDTO {
  return {
    id: "cob-1",
    tiendaId: "tienda-1",
    status: "activo",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
    tarifaEspecial: null,
    zonaId: null,
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function buildRepo(overrides: Partial<ITarifaRepository> = {}): ITarifaRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [dto()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    hardDelete: vi.fn().mockResolvedValue("ok" as const),
    esTiendaAsignable: vi.fn().mockResolvedValue(true),
    existeZona: vi.fn().mockResolvedValue(true),
    inactivarPorTienda: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function crearInput(overrides: Partial<CrearTarifaInput> = {}): CrearTarifaInput {
  return {
    tiendaId: "tienda-1",
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

let repo: ITarifaRepository;
let service: TarifaService;

beforeEach(() => {
  repo = buildRepo();
  service = new TarifaService(repo);
});

describe("crear — matriz de autorizacion (R9-R13/R16)", () => {
  it("R10: maestro crea", async () => {
    const r = await service.crear(crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
    // Los opcionales ausentes se normalizan antes de llegar al repositorio:
    // `null` los nullables, `false` el flag de tarifa por defecto.
    expect(repo.create).toHaveBeenCalledWith({
      ...crearInput(),
      tarifaEspecial: null,
      zonaId: null,
      isDefault: false,
    });
  });

  it("R11: admin no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R12: adminTienda no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R12: mensajero no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.crear(crearInput(), DESCONOCIDO);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R16: crear valido persiste y devuelve el DTO", async () => {
    const r = await service.crear(crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.tarifa).toEqual(dto());
  });

  // Invariante del modelo nuevo: la tarifa pertenece a una tienda, y esa tienda
  // debe ser un usuario con rol adminTienda.
  it("R15: tienda que no es adminTienda -> validation_error sin persistir", async () => {
    repo = buildRepo({ esTiendaAsignable: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.crear(crearInput({ tiendaId: "no-tienda" }), MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("tiendaId");
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("no-tienda");
    expect(repo.create).not.toHaveBeenCalled();
  });

  // El service NO restringe el rol del duenno mas alla de lo que responde el
  // repo: si la cuenta es tarifable (adminTienda o la cuenta dedicada de una
  // API key), la tarifa se persiste sin distincion alguna.
  it("la cuenta dedicada de una API key se puede tarifar como una tienda", async () => {
    repo = buildRepo({ esTiendaAsignable: vi.fn().mockResolvedValue(true) });
    service = new TarifaService(repo);

    const r = await service.crear(crearInput({ tiendaId: "usuario-de-la-key" }), MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("usuario-de-la-key");
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tiendaId: "usuario-de-la-key" }),
    );
  });

  // Tarifa especial: unico campo opcional. Ausente NO es 0 -> viaja como null.
  it("crear sin tarifa especial la persiste como null (no como 0)", async () => {
    await service.crear(crearInput(), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tarifaEspecial: null }),
    );
  });

  it("crear con tarifa especial la persiste con su monto", async () => {
    await service.crear(crearInput({ tarifaEspecial: 1250.5 }), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tarifaEspecial: 1250.5 }),
    );
  });

  // zonaId es OPCIONAL: sin zona la tarifa aplica a la tienda entera.
  it("crear sin zona no comprueba la zona y persiste zonaId null", async () => {
    await service.crear(crearInput(), MAESTRO);
    expect(repo.existeZona).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ zonaId: null }));
  });

  it("crear con zona existente la persiste", async () => {
    await service.crear(crearInput({ zonaId: "zona-1" }), MAESTRO);
    expect(repo.existeZona).toHaveBeenCalledWith("zona-1");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ zonaId: "zona-1" }));
  });

  // Sin esta comprobacion un id invalido escaparia como error crudo de FK.
  it("crear con una zona inexistente -> validation_error sin persistir", async () => {
    repo = buildRepo({ existeZona: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.crear(crearInput({ zonaId: "no-existe" }), MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("zonaId");
    expect(repo.create).not.toHaveBeenCalled();
  });

  // isDefault nace en false: marcarla por defecto es un acto explicito.
  it("crear sin isDefault la persiste como false", async () => {
    await service.crear(crearInput(), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }));
  });

  it("crear con isDefault true lo respeta", async () => {
    await service.crear(crearInput({ isDefault: true }), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
  });
});

describe("obtener (R9-R13/R17/R19)", () => {
  it("R10: maestro obtiene", async () => {
    const r = await service.obtener("cob-1", MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("R11: admin obtiene (solo lectura)", async () => {
    const r = await service.obtener("cob-1", ADMIN);
    expect(r.status).toBe("ok");
  });

  it("R12: adminTienda no puede obtener -> forbidden", async () => {
    const r = await service.obtener("cob-1", TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("R12: mensajero no puede obtener -> forbidden", async () => {
    const r = await service.obtener("cob-1", MENSAJERO);
    expect(r.status).toBe("forbidden");
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.obtener("cob-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R17/R19: inexistente o borrado -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.obtener("x", MAESTRO);
    expect(r.status).toBe("not_found");
  });
});

describe("listar (R9-R13/R18/R19)", () => {
  it("R10/R11: maestro y admin listan", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await service.listar({ page: 1, pageSize: 20 }, actor);
      expect(r.status).toBe("ok");
    }
  });

  it("R12: adminTienda/mensajero no listan -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.listar({ page: 1, pageSize: 20 }, actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.listar({ page: 1, pageSize: 20 }, DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R18: devuelve items/page/pageSize/total y calcula skip", async () => {
    const r = await service.listar({ page: 2, pageSize: 10 }, MAESTRO);
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

  it("R19: no expone borrados (delegado al repo, que ya filtra)", async () => {
    repo = buildRepo({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    service = new TarifaService(repo);
    const r = await service.listar({ page: 1, pageSize: 20 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toHaveLength(0);
  });
});

describe("actualizar (R9-R13/R20-R23)", () => {
  it("R10: maestro aplica solo los campos presentes y delega", async () => {
    const r = await service.actualizar("cob-1", { tiendaId: "tienda-2", fulfillment: 9 }, MAESTRO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ tiendaId: "tienda-2", fulfillment: 9 });
  });

  it("R22: no toca id/created_at (no estan en UpdateTarifaData)", async () => {
    await service.actualizar("cob-1", { tiendaId: "tienda-2" }, MAESTRO);
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).not.toHaveProperty("id");
    expect(data).not.toHaveProperty("createdAt");
  });

  it("R11: admin no puede actualizar -> forbidden", async () => {
    const r = await service.actualizar("cob-1", { tiendaId: "tienda-2" }, ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R12: adminTienda/mensajero no pueden actualizar -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.actualizar("cob-1", { tiendaId: "tienda-2" }, actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.actualizar("cob-1", { tiendaId: "tienda-2" }, DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R21: inexistente o borrado -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.actualizar("x", { tiendaId: "tienda-2" }, MAESTRO);
    expect(r.status).toBe("not_found");
    expect(repo.update).not.toHaveBeenCalled();
  });

  // Invariante del modelo nuevo, lado actualizar: reasignar a una tienda que no
  // es adminTienda, o reactivar una tarifa de una tienda degradada, se rechaza.
  it("R23: reasignar a una tienda que no es adminTienda -> validation_error sin update", async () => {
    repo = buildRepo({ esTiendaAsignable: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { tiendaId: "no-tienda" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("tiendaId");
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("no-tienda");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R23: reactivar (status activo) revalida la tienda actual -> validation_error si dejo de ser adminTienda", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(dto({ tiendaId: "degradada", status: "inactivo" })),
      esTiendaAsignable: vi.fn().mockResolvedValue(false),
    });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { status: "activo" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    // sin tiendaId en el input, la tienda efectiva es la del registro existente.
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("degradada");
    expect(repo.update).not.toHaveBeenCalled();
  });

  // Actualizar distingue "no viene" de "viene en null": lo primero no toca la
  // columna, lo segundo LIMPIA el pacto especial.
  it("actualizar sin tarifaEspecial no toca la columna", async () => {
    await service.actualizar("cob-1", { fulfillment: 9 }, MAESTRO);
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).not.toHaveProperty("tarifaEspecial");
  });

  it("actualizar con zonaId null desacota la tarifa sin comprobar zona", async () => {
    await service.actualizar("cob-1", { zonaId: null }, MAESTRO);
    expect(repo.existeZona).not.toHaveBeenCalled();
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toHaveProperty("zonaId", null);
  });

  it("actualizar a una zona inexistente -> validation_error sin update", async () => {
    repo = buildRepo({ existeZona: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { zonaId: "no-existe" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("actualizar con tarifaEspecial null limpia el pacto especial", async () => {
    await service.actualizar("cob-1", { tarifaEspecial: null }, MAESTRO);
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toHaveProperty("tarifaEspecial", null);
  });

  it("R23: solo revalida la tienda si se reasigna o se reactiva", async () => {
    // cambio numerico puro: no hay motivo para revalidar la tienda.
    await service.actualizar("cob-1", { fulfillment: 9 }, MAESTRO);
    expect(repo.esTiendaAsignable).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();

    // desactivar tampoco revalida (siempre se puede inactivar).
    await service.actualizar("cob-1", { status: "inactivo" }, MAESTRO);
    expect(repo.esTiendaAsignable).not.toHaveBeenCalled();

    // reactivar si.
    await service.actualizar("cob-1", { status: "activo" }, MAESTRO);
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("tienda-1");
  });
});

describe("borrar (R9-R13)", () => {
  it("R10: maestro borra (borrado FISICO) -> ok", async () => {
    const r = await service.borrar("cob-1", MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.hardDelete).toHaveBeenCalledWith("cob-1");
  });

  it("R11: admin no puede borrar -> forbidden", async () => {
    const r = await service.borrar("cob-1", ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("R12: adminTienda/mensajero no pueden borrar -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.borrar("cob-1", actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.borrar("cob-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  // El borrado es FISICO y `cierre_detail.tarifa_id` es FK RESTRICT: una tarifa que
  // ya liquido un cierre no se puede sacar. Eso NO es un "no existe" -existe, y muy
  // concretamente-, y confundirlos le diria al maestro que la borro cuando no.
  it("tarifa congelada en un cierre -> conflict (no not_found)", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("referenced" as const) });
    service = new TarifaService(repo);
    const r = await service.borrar("cob-1", MAESTRO);
    expect(r.status).toBe("conflict");
  });

  it("carrera: existia al comprobar y ya no al borrar -> not_found", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("not_found" as const) });
    service = new TarifaService(repo);
    const r = await service.borrar("cob-1", MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("inexistente -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.borrar("x", MAESTRO);
    expect(r.status).toBe("not_found");
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("desaparece del listado tras borrar (repo delega correctamente)", async () => {
    await service.borrar("cob-1", MAESTRO);
    repo = buildRepo({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    service = new TarifaService(repo);
    const r = await service.listar({ page: 1, pageSize: 20 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toHaveLength(0);
  });
});
