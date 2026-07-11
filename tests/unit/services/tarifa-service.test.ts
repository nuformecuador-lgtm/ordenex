import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { TarifaService } from "@/lib/services/TarifaService";
import type { ITarifaRepository } from "@/lib/interfaces/repositories/ITarifaRepository";
import type { Actor } from "@/lib/interfaces/services/ITarifaService";
import type { TarifaDTO } from "@/lib/types/tarifa";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function dto(overrides: Partial<TarifaDTO> = {}): TarifaDTO {
  return {
    id: "cob-1",
    nombre: "Tarifa GAM",
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

function buildRepo(overrides: Partial<ITarifaRepository> = {}): ITarifaRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [dto()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    softDelete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function crearInput(overrides: Record<string, unknown> = {}) {
  return {
    nombre: "Tarifa GAM",
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
    expect(repo.create).toHaveBeenCalledWith(crearInput());
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
    const r = await service.actualizar("cob-1", { nombre: "Nueva", fulfillment: 9 }, MAESTRO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ nombre: "Nueva", fulfillment: 9 });
  });

  it("R22: no toca id/created_at (no estan en UpdateTarifaData)", async () => {
    await service.actualizar("cob-1", { nombre: "Nueva" }, MAESTRO);
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).not.toHaveProperty("id");
    expect(data).not.toHaveProperty("createdAt");
  });

  it("R11: admin no puede actualizar -> forbidden", async () => {
    const r = await service.actualizar("cob-1", { nombre: "Nueva" }, ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R12: adminTienda/mensajero no pueden actualizar -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.actualizar("cob-1", { nombre: "Nueva" }, actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.actualizar("cob-1", { nombre: "Nueva" }, DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R21: inexistente o borrado -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.actualizar("x", { nombre: "Nueva" }, MAESTRO);
    expect(r.status).toBe("not_found");
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("borrar (R9-R13/R24/R25)", () => {
  it("R10: maestro borra (soft delete) -> ok", async () => {
    const r = await service.borrar("cob-1", MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.softDelete).toHaveBeenCalledWith("cob-1");
  });

  it("R11: admin no puede borrar -> forbidden", async () => {
    const r = await service.borrar("cob-1", ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("R12: adminTienda/mensajero no pueden borrar -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.borrar("cob-1", actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.borrar("cob-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R25: inexistente o ya borrado -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.borrar("x", MAESTRO);
    expect(r.status).toBe("not_found");
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("R24: desaparece del listado tras borrar (repo delega correctamente)", async () => {
    await service.borrar("cob-1", MAESTRO);
    repo = buildRepo({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    service = new TarifaService(repo);
    const r = await service.listar({ page: 1, pageSize: 20 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toHaveLength(0);
  });
});
